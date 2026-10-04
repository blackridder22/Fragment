//! Release-only measurements against actual decoding, rendering and SQLite. Never native UI proof.
use fragment_core::{models::ColorFilter, FragmentCore, FragmentFilter};
use rusqlite::{params, Connection};
use serde_json::json;
use std::{fs, path::PathBuf, sync::atomic::AtomicBool, time::Instant};

fn elapsed(start: Instant) -> f64 {
    start.elapsed().as_secs_f64() * 1000.0
}
fn summary(samples: &[f64]) -> serde_json::Value {
    let mut sorted = samples.to_vec();
    sorted.sort_by(f64::total_cmp);
    json!({"samples":samples,"p50Ms":sorted[sorted.len()/2],"p95Ms":sorted[(sorted.len()*95/100).min(sorted.len()-1)],"maxMs":sorted.last()})
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let corpus = PathBuf::from(
        std::env::args_os()
            .nth(1)
            .ok_or("corpus directory required")?,
    );
    let output = PathBuf::from(
        std::env::args_os()
            .nth(2)
            .ok_or("output directory required")?,
    );
    fs::create_dir_all(&output)?;
    let dir = tempfile::tempdir_in(&output)?;
    let core = FragmentCore::new_at(dir.path().to_path_buf())?;
    let mut decode = Vec::new();
    let mut palette = Vec::new();
    let mut imports = Vec::new();
    let raster_names = [
        "solid-red.png",
        "two-color.png",
        "transparent-logo.png",
        "grayscale.png",
        "gradient.png",
        "nasa-blue-marble.jpg",
    ];
    let mut thumbs = Vec::new();
    for name in raster_names {
        let start = Instant::now();
        let image = image::open(corpus.join(name))?;
        thumbs.push(image.thumbnail(640, 640));
        decode.push(elapsed(start));
    }
    for index in 0..100 {
        let start = Instant::now();
        let colors = fragment_core::palette::extract(&thumbs[index % thumbs.len()]);
        std::hint::black_box(colors);
        palette.push(elapsed(start));
    }
    for index in 0..100 {
        let mut image = thumbs[index % thumbs.len()].to_rgba8();
        image.put_pixel(0, 0, image::Rgba([index as u8, 0, 0, 255]));
        let path = dir.path().join("import-source.png");
        image.save(&path)?;
        let start = Instant::now();
        core.import_image(
            None,
            path.to_string_lossy().into_owned(),
            Some(format!("Benchmark {index}")),
        )?;
        imports.push(elapsed(start));
    }
    let svg_names = [
        "two-color.svg",
        "transparent-logo.svg",
        "gradient-mask.svg",
        "filter-clip.svg",
        "embedded.svg",
        "text.svg",
        "missing-font.svg",
    ];
    let mut svg = Vec::new();
    for index in 0..105 {
        let name = svg_names[index % svg_names.len()];
        let bytes = fs::read(corpus.join(name))?;
        let start = Instant::now();
        let rendered = fragment_core::svg_worker::render_svg(
            &bytes,
            &[640, 1600],
            &core.paths().temp_dir(),
            &AtomicBool::new(false),
        )?;
        let ms = elapsed(start);
        if index < svg_names.len() {
            fs::write(output.join(format!("{name}.png")), rendered.png(640)?)?;
        }
        svg.push(ms);
    }
    // Clone real imported asset metadata into an actual SQLite dataset. This measures queries,
    // not file decoding or native scrolling; the cloned files deliberately remain shared fixtures.
    let red = core.import_image(
        None,
        corpus.join("solid-red.png").to_string_lossy().into_owned(),
        Some("Red".into()),
    )?;
    let mut db = Connection::open(core.paths().db_path())?;
    db.pragma_update(None, "foreign_keys", "ON")?;
    let tx = db.transaction()?;
    for index in 0..9899 {
        let id = format!("bench-asset-{index:05}");
        let sha = format!("bench-hash-{index:05}");
        tx.execute("INSERT INTO assets(id,original_path,thumbnail_path,preview_path,mime_type,width,height,file_size,sha256,created_at,updated_at) SELECT ?1,original_path,thumbnail_path,preview_path,mime_type,width,height,file_size,?2,created_at,updated_at FROM assets WHERE id=?3",params![id,sha,red.asset_id])?;
        tx.execute("INSERT INTO fragments(id,asset_id,frame_id,title,original_path,thumbnail_path,mime_type,width,height,file_size,sha256,captured_at,created_at,updated_at) SELECT ?1,?1,frame_id,?2,original_path,thumbnail_path,mime_type,width,height,file_size,?3,captured_at,created_at,updated_at FROM fragments WHERE id=?4",params![id,format!("Reference {index:05}"),sha,red.id])?;
        tx.execute("INSERT INTO asset_palettes SELECT ?1,algorithm_version,?2,status,attempts,error_code,next_retry_at,lease_token,lease_expires_at,updated_at FROM asset_palettes WHERE asset_id=?3",params![id,sha,red.asset_id])?;
        tx.execute("INSERT INTO asset_palette_colors SELECT ?1,rank,r,g,b,l,a,lab_b,coverage FROM asset_palette_colors WHERE asset_id=?2",params![id,red.asset_id])?;
    }
    tx.commit()?;
    let mut queries = Vec::new();
    let mut unfiltered = Vec::new();
    for index in 0..55 {
        let start = Instant::now();
        let page = core.list_fragment_page_snapshot(
            None,
            false,
            false,
            FragmentFilter::default(),
            None,
            0,
            60,
        )?;
        std::hint::black_box(page);
        if index >= 5 {
            unfiltered.push(elapsed(start));
        }
        let filter = FragmentFilter {
            color: Some(ColorFilter {
                hex: "#FF0000".into(),
                tolerance: 80,
            }),
            title_contains: (index % 2 == 0).then(|| "Reference".into()),
            mime_types: vec!["image/png".into()],
            ..Default::default()
        };
        let start = Instant::now();
        let page = core.list_fragment_page_snapshot(None, false, false, filter, None, 0, 60)?;
        std::hint::black_box(page);
        if index >= 5 {
            queries.push(elapsed(start));
        }
    }
    let count = core.list_all_fragments()?.len();
    let result = json!({"build":"release","corpus":corpus.file_name(),"memberships":count,"decodeMs":decode,"palette":summary(&palette),"rasterImport":summary(&imports),"svgColdProcess":summary(&svg),"sqliteColorPageAndCount":summary(&queries),"sqliteUnfilteredPageAndCount":summary(&unfiltered),"limitations":["Generated metadata clones use shared fixture paths; this is SQL timing, not native gallery timing","Cold means new SVG process; OS disk cache is uncontrolled"]});
    fs::write(
        output.join("rust-sqlite-measurements.json"),
        serde_json::to_vec_pretty(&result)?,
    )?;
    println!(
        "{}",
        serde_json::to_string_pretty(
            &json!({"memberships":count,"paletteP95":summary(&palette)["p95Ms"],"svgP95":summary(&svg)["p95Ms"],"colorQueryP95":summary(&queries)["p95Ms"],"rasterImportP95":summary(&imports)["p95Ms"]})
        )?
    );
    Ok(())
}
