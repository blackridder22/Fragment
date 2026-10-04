//! Static SVG policy and renderer. Called exclusively inside the killable private host worker.
use std::{fs, io::Cursor, path::Path, sync::Arc};

use base64::Engine;
use image::{ImageFormat, ImageReader};
use quick_xml::{events::Event, Reader};
use resvg::{tiny_skia, usvg};
use serde::{Deserialize, Serialize};

use crate::{hashing::sha256_hex, storage::write_atomic};

pub const MAX_SVG_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_EDGE: u32 = 4096;
pub const RENDER_POLICY: &str = "resvg-0.48.1-policy-1";

pub fn font_fingerprint() -> &'static str {
    static FINGERPRINT: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    FINGERPRINT.get_or_init(|| {
        fn scan(path: &Path, files: &mut Vec<String>, depth: usize) {
            if depth > 8 {
                return;
            }
            if let Ok(entries) = fs::read_dir(path) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if let Ok(meta) = entry.metadata() {
                        if meta.is_dir() {
                            scan(&path, files, depth + 1)
                        } else {
                            files.push(format!(
                                "{}:{}:{:?}",
                                path.display(),
                                meta.len(),
                                meta.modified().ok()
                            ));
                        }
                    }
                }
            }
        }
        let mut files = Vec::new();
        for directory in [
            "/System/Library/Fonts",
            "/Library/Fonts",
            "/usr/share/fonts",
            "/usr/local/share/fonts",
        ] {
            scan(Path::new(directory), &mut files, 0)
        }
        if let Some(home) = std::env::var_os("HOME") {
            scan(&Path::new(&home).join("Library/Fonts"), &mut files, 0);
            scan(&Path::new(&home).join(".local/share/fonts"), &mut files, 0);
        }
        files.sort();
        sha256_hex(format!("{RENDER_POLICY}\n{}", files.join("\n")).as_bytes())
    })
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SvgErrorCode {
    InvalidSvg,
    UnsupportedSvg,
    SvgTooLarge,
    SvgRenderTimeout,
    SvgBusy,
    SvgCancelled,
    SvgWorkerUnavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize, thiserror::Error)]
#[error("{message}")]
pub struct SvgError {
    pub code: SvgErrorCode,
    pub message: String,
}

impl SvgError {
    pub fn new(code: SvgErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
    pub fn too_large() -> Self {
        Self::new(
            SvgErrorCode::SvgTooLarge,
            "SVG exceeds the 5 MiB input limit",
        )
    }
    fn invalid(message: impl Into<String>) -> Self {
        Self::new(SvgErrorCode::InvalidSvg, message)
    }
    fn unsupported(message: impl Into<String>) -> Self {
        Self::new(SvgErrorCode::UnsupportedSvg, message)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RenderWarning {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SvgRenderOutput {
    pub width: i64,
    pub height: i64,
    pub fingerprint: String,
    pub warnings: Vec<RenderWarning>,
    pub tiers: Vec<u32>,
}

// Style URLs are tokenized, including CSS escapes; document-controlled resources never reach usvg.
fn validate_css(value: &str) -> Result<(), SvgError> {
    use cssparser::{Parser, ParserInput, Token};
    fn tokens<'i, 't>(p: &mut Parser<'i, 't>) -> Result<(), cssparser::ParseError<'i, ()>> {
        while let Ok(token) = p.next_including_whitespace_and_comments().cloned() {
            match token {
                Token::AtKeyword(_) => return Err(p.new_custom_error(())),
                Token::UnquotedUrl(url) if !url.starts_with('#') => {
                    return Err(p.new_custom_error(()))
                }
                Token::Function(name) if name.eq_ignore_ascii_case("url") => {
                    p.parse_nested_block(|inner| {
                        let value = inner.expect_url_or_string()?;
                        if !value.starts_with('#') {
                            return Err(inner.new_custom_error(()));
                        }
                        inner.expect_exhausted()?;
                        Ok(())
                    })?;
                }
                Token::Function(_)
                | Token::ParenthesisBlock
                | Token::SquareBracketBlock
                | Token::CurlyBracketBlock => p.parse_nested_block(tokens)?,
                Token::BadUrl(_) | Token::BadString(_) => return Err(p.new_custom_error(())),
                _ => {}
            }
        }
        Ok(())
    }
    let mut input = ParserInput::new(value);
    tokens(&mut Parser::new(&mut input)).map_err(|_| SvgError::unsupported("SVG styles must use internal references; external styles, fonts and URLs are unsupported"))
}

fn raster_pixels(bytes: &[u8]) -> Result<u64, SvgError> {
    let format =
        image::guess_format(bytes).map_err(|_| SvgError::unsupported("Invalid embedded image"))?;
    if !matches!(
        format,
        ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP
    ) {
        return Err(SvgError::unsupported(
            "Embedded SVG images must be PNG, JPEG or WebP",
        ));
    }
    let (w, h) = ImageReader::with_format(Cursor::new(bytes), format)
        .into_dimensions()
        .map_err(|_| SvgError::invalid("Invalid embedded image dimensions"))?;
    Ok(u64::from(w) * u64::from(h))
}

fn embedded_pixels(href: &str) -> Result<u64, SvgError> {
    let (header, data) = href.split_once(',').ok_or_else(|| {
        SvgError::unsupported("SVG images must be embedded base64 PNG, JPEG or WebP")
    })?;
    if !matches!(
        header,
        "data:image/png;base64" | "data:image/jpeg;base64" | "data:image/webp;base64"
    ) {
        return Err(SvgError::unsupported(
            "SVG images must be embedded base64 PNG, JPEG or WebP",
        ));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| SvgError::invalid("Invalid embedded image encoding"))?;
    raster_pixels(&bytes)
}

#[derive(Default)]
struct Preflight {
    embedded_pixels: u64,
}

fn preflight(bytes: &[u8]) -> Result<Preflight, SvgError> {
    if bytes.len() > MAX_SVG_BYTES {
        return Err(SvgError::too_large());
    }
    let text = std::str::from_utf8(bytes).map_err(|_| SvgError::invalid("SVG must be UTF-8"))?;
    let mut reader = Reader::from_str(text.trim_start_matches('\u{feff}'));
    let mut depth = 0_usize;
    let mut elements = 0_usize;
    let mut root_seen = false;
    let mut style_depth = None;
    let mut style_text = String::new();
    let mut result = Preflight::default();
    // Reject unsupported elements rather than silently displaying an incomplete illustration.
    const ELEMENTS: &[&str] = &[
        "svg",
        "g",
        "defs",
        "title",
        "desc",
        "metadata",
        "path",
        "rect",
        "circle",
        "ellipse",
        "line",
        "polyline",
        "polygon",
        "text",
        "tspan",
        "textPath",
        "use",
        "symbol",
        "a",
        "switch",
        "image",
        "linearGradient",
        "radialGradient",
        "stop",
        "pattern",
        "clipPath",
        "mask",
        "marker",
        "filter",
        "feBlend",
        "feColorMatrix",
        "feComponentTransfer",
        "feComposite",
        "feConvolveMatrix",
        "feDiffuseLighting",
        "feDisplacementMap",
        "feDistantLight",
        "feDropShadow",
        "feFlood",
        "feFuncA",
        "feFuncB",
        "feFuncG",
        "feFuncR",
        "feGaussianBlur",
        "feImage",
        "feMerge",
        "feMergeNode",
        "feMorphology",
        "feOffset",
        "fePointLight",
        "feSpecularLighting",
        "feSpotLight",
        "feTile",
        "feTurbulence",
        "style",
    ];
    loop {
        match reader
            .read_event()
            .map_err(|_| SvgError::invalid("Malformed SVG XML"))?
        {
            Event::Start(ref element) | Event::Empty(ref element) => {
                elements += 1;
                if elements > 100_000 || depth >= 128 {
                    return Err(SvgError::unsupported(
                        "SVG exceeds the element or nesting limit",
                    ));
                }
                let name = element.local_name();
                let name = std::str::from_utf8(name.as_ref())
                    .map_err(|_| SvgError::invalid("Invalid SVG element"))?;
                if depth == 0 {
                    if root_seen || name != "svg" {
                        return Err(SvgError::invalid("Expected one SVG root element"));
                    }
                    root_seen = true;
                }
                if !ELEMENTS.contains(&name) {
                    return Err(SvgError::unsupported(format!(
                        "Unsupported SVG element: {name}"
                    )));
                }
                for attr in element.attributes() {
                    let attr = attr.map_err(|_| SvgError::invalid("Invalid SVG attribute"))?;
                    let key = attr.key.local_name();
                    let key = std::str::from_utf8(key.as_ref())
                        .map_err(|_| SvgError::invalid("Invalid SVG attribute"))?;
                    let value = attr
                        .decode_and_unescape_value(reader.decoder())
                        .map_err(|_| SvgError::invalid("Invalid SVG attribute encoding"))?;
                    if key.starts_with("on") || key == "base" {
                        return Err(SvgError::unsupported(
                            "SVG scripts and external resource bases are unsupported",
                        ));
                    }
                    if key == "href" && name != "a" {
                        if matches!(name, "image" | "feImage") && value.starts_with("data:") {
                            result.embedded_pixels += embedded_pixels(&value)?;
                        } else if !value.starts_with('#') {
                            return Err(SvgError::unsupported("External SVG resources are unsupported; embed images or use internal references"));
                        }
                    }
                    if matches!(
                        key,
                        "style"
                            | "fill"
                            | "stroke"
                            | "filter"
                            | "clip-path"
                            | "mask"
                            | "marker-start"
                            | "marker-mid"
                            | "marker-end"
                    ) {
                        validate_css(&value)?;
                    }
                }
                if result.embedded_pixels > 32_000_000 {
                    return Err(SvgError::unsupported(
                        "Embedded images exceed the 32 megapixel limit",
                    ));
                }
                // Empty elements have already ended; position in the input distinguishes them.
                let is_empty = text.trim_start_matches('\u{feff}').as_bytes()
                    [..reader.buffer_position() as usize]
                    .ends_with(b"/>");
                if !is_empty {
                    depth += 1;
                    if name == "style" {
                        style_depth = Some(depth);
                        style_text.clear();
                    }
                }
            }
            Event::End(_) => {
                if style_depth == Some(depth) {
                    validate_css(&style_text)?;
                    style_depth = None;
                }
                depth = depth
                    .checked_sub(1)
                    .ok_or_else(|| SvgError::invalid("Unbalanced SVG"))?;
            }
            Event::DocType(_) | Event::PI(_) => {
                return Err(SvgError::unsupported(
                    "SVG DTDs, entities and processing instructions are unsupported",
                ))
            }
            Event::Text(value) if style_depth.is_some() => {
                let decoded = value
                    .decode()
                    .map_err(|_| SvgError::invalid("Invalid SVG style"))?;
                style_text.push_str(
                    &quick_xml::escape::unescape(&decoded)
                        .map_err(|_| SvgError::invalid("Invalid style entity"))?,
                );
            }
            Event::CData(value) if style_depth.is_some() => style_text.push_str(
                &value
                    .decode()
                    .map_err(|_| SvgError::invalid("Invalid SVG style"))?,
            ),
            Event::GeneralRef(value) if style_depth.is_some() => {
                let reference = format!(
                    "&{};",
                    value
                        .decode()
                        .map_err(|_| SvgError::invalid("Invalid style entity"))?
                );
                style_text.push_str(
                    &quick_xml::escape::unescape(&reference)
                        .map_err(|_| SvgError::invalid("Invalid style entity"))?,
                );
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if !root_seen || depth != 0 {
        return Err(SvgError::invalid("Incomplete SVG document"));
    }
    Ok(result)
}

pub fn render(bytes: &[u8], tiers: &[u32], directory: &Path) -> Result<SvgRenderOutput, SvgError> {
    preflight(bytes)?;
    if tiers.is_empty()
        || tiers.len() > 3
        || tiers
            .iter()
            .any(|edge| !matches!(*edge, 640 | 1600 | 3200 | 4096))
    {
        return Err(SvgError::invalid("Invalid SVG render tier"));
    }
    let mut options = usvg::Options::default();
    options.fontdb_mut().load_system_fonts();
    options.font_family = "Arial".into();
    let fingerprint = font_fingerprint().to_string();
    let substituted = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let observed = Arc::clone(&substituted);
    let default_selector = usvg::FontResolver::default_font_selector();
    options.font_resolver.select_font = Box::new(move |font, db| {
        if font.families().iter().any(|family| match family {
            usvg::FontFamily::Named(name) => !db.faces().any(|face| {
                face.families
                    .iter()
                    .any(|(candidate, _)| candidate.eq_ignore_ascii_case(name))
            }),
            _ => false,
        }) {
            observed.store(true, std::sync::atomic::Ordering::Relaxed);
        }
        default_selector(font, db)
    });
    // Both resolvers are replaced. Never let usvg's default string resolver read local files.
    options.image_href_resolver = usvg::ImageHrefResolver {
        resolve_string: Box::new(|_, _| None),
        resolve_data: Box::new(|_, data: Arc<Vec<u8>>, _| {
            match image::guess_format(&data).ok()? {
                ImageFormat::Png => Some(usvg::ImageKind::PNG(data)),
                ImageFormat::Jpeg => Some(usvg::ImageKind::JPEG(data)),
                ImageFormat::WebP => Some(usvg::ImageKind::WEBP(data)),
                _ => None,
            }
        }),
    };
    let tree = usvg::Tree::from_data(bytes, &options)
        .map_err(|_| SvgError::invalid("SVG could not be parsed"))?;
    let warnings = if substituted.load(std::sync::atomic::Ordering::Relaxed) {
        vec![RenderWarning{code:"font_substitution".into(),message:"An unavailable font was replaced with an installed fallback. The original SVG is unchanged.".into()}]
    } else {
        vec![]
    };
    // Count rendered instances, including duplicated <use> expansions, before raster allocation.
    fn image_budget(group: &usvg::Group, total: &mut u64) -> Result<(), SvgError> {
        for node in group.children() {
            let mut subroot_error = None;
            node.subroots(|root| {
                if subroot_error.is_none() {
                    if let Err(error) = image_budget(root, total) {
                        subroot_error = Some(error);
                    }
                }
            });
            if let Some(error) = subroot_error {
                return Err(error);
            }
            match node {
                usvg::Node::Group(g) => image_budget(g, total)?,
                usvg::Node::Image(i) => {
                    let bytes = match i.kind() {
                        usvg::ImageKind::PNG(b)
                        | usvg::ImageKind::JPEG(b)
                        | usvg::ImageKind::WEBP(b) => b,
                        _ => return Err(SvgError::unsupported("Unsupported embedded image")),
                    };
                    *total = total.saturating_add(raster_pixels(bytes)?);
                    if *total > 32_000_000 {
                        return Err(SvgError::unsupported(
                            "Rendered embedded images exceed 32 megapixels",
                        ));
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }
    image_budget(tree.root(), &mut 0)?;
    fs::create_dir_all(directory)
        .map_err(|_| SvgError::invalid("Cannot create SVG staging directory"))?;
    let size = tree.size();
    for edge in tiers {
        let scale = *edge as f32 / size.width().max(size.height());
        let width = (size.width() * scale).round().max(1.0) as u32;
        let height = (size.height() * scale).round().max(1.0) as u32;
        if width > MAX_EDGE || height > MAX_EDGE {
            return Err(SvgError::invalid("SVG output exceeds pixel limits"));
        }
        let mut pixmap = tiny_skia::Pixmap::new(width, height)
            .ok_or_else(|| SvgError::invalid("SVG pixel allocation failed"))?;
        resvg::render(
            &tree,
            tiny_skia::Transform::from_scale(scale, scale),
            &mut pixmap.as_mut(),
        );
        // tiny-skia's PNG encoder demultiplies alpha. PNG consumers receive straight RGBA.
        let png = pixmap
            .encode_png()
            .map_err(|_| SvgError::invalid("SVG PNG encoding failed"))?;
        write_atomic(&directory.join(format!("{edge}.png")), &png)
            .map_err(|_| SvgError::invalid("SVG PNG write failed"))?;
    }
    Ok(SvgRenderOutput {
        width: size.width().round().max(1.0) as i64,
        height: size.height().round().max(1.0) as i64,
        fingerprint,
        warnings,
        tiers: tiers.to_vec(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn policy_rejects_external_and_active_content() {
        for body in [
            "<script/>",
            "<animate/>",
            "<foreignObject/>",
            "<image href='/tmp/private.png'/>",
            "<image href='https://example.invalid/x.png'/>",
            "<style>@import 'x';</style>",
            "<rect fill='url(https://example.invalid/x)'/>",
        ] {
            assert!(
                preflight(
                    format!("<svg xmlns='http://www.w3.org/2000/svg'>{body}</svg>").as_bytes()
                )
                .is_err(),
                "{body}"
            );
        }
        assert!(preflight(b"<!DOCTYPE svg><svg/>").is_err());
        assert!(preflight(b"<html/>").is_err());
        assert!(preflight(b"<svg><g></svg>").is_err());
        assert!(preflight(
            b"<svg><defs><linearGradient id='a'/></defs><path fill='url(#a)'/></svg>"
        )
        .is_ok());
    }
    #[test]
    fn css_escaped_external_url_is_rejected() {
        assert!(validate_css("fill:u\\72l('file:///private/image.png')").is_err());
        assert!(validate_css("fill:url('#inside')").is_ok());
        assert!(preflight(br##"<svg><style>path{fill:url(&quot;https://example.invalid/image&quot;)}</style></svg>"##).is_err());
        assert!(preflight(
            br##"<svg><style><![CDATA[path[data-name='A&B']{fill:#fff}]]></style></svg>"##
        )
        .is_ok());
    }

    #[test]
    fn rejects_byte_and_element_limits_before_rendering() {
        assert_eq!(
            preflight(&vec![b' '; MAX_SVG_BYTES + 1])
                .err()
                .unwrap()
                .code,
            SvgErrorCode::SvgTooLarge
        );
        let input = format!("<svg>{}</svg>", "<path/>".repeat(100_000));
        assert_eq!(
            preflight(input.as_bytes()).err().unwrap().code,
            SvgErrorCode::UnsupportedSvg
        );
    }
}
