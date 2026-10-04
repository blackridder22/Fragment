//! Generate 1,000 real PNGs and 100 equivalent SVG originals for native .7/.8 comparison.
use base64::Engine;
use std::{fs, path::PathBuf, sync::atomic::AtomicBool};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let corpus = PathBuf::from(std::env::args_os().nth(1).ok_or("corpus")?);
    let out = PathBuf::from(std::env::args_os().nth(2).ok_or("output")?);
    fs::create_dir_all(&out)?;
    let names = [
        "solid-red.png",
        "two-color.png",
        "transparent-logo.png",
        "grayscale.png",
        "gradient.png",
        "nasa-blue-marble.jpg",
    ];
    let images = names
        .iter()
        .map(|n| image::open(corpus.join(n)).map(|i| i.thumbnail(640, 640).to_rgba8()))
        .collect::<Result<Vec<_>, _>>()?;
    for index in 0..1000 {
        let mut im = images[index % images.len()].clone();
        im.put_pixel(
            0,
            0,
            image::Rgba([(index % 256) as u8, (index / 256) as u8, 127, 255]),
        );
        let path = out.join(format!("media-{index:04}.png"));
        im.save(&path)?;
        if index % 10 == 0 {
            let data = base64::engine::general_purpose::STANDARD.encode(fs::read(&path)?);
            let svg=format!("<svg xmlns='http://www.w3.org/2000/svg' width='{}' height='{}'><image width='100%' height='100%' href='data:image/png;base64,{data}'/></svg>",im.width(),im.height());
            fs::write(out.join(format!("media-{index:04}.svg")), &svg)?;
            let rendered = fragment_core::svg_worker::render_svg(
                svg.as_bytes(),
                &[640, 1600],
                &out,
                &AtomicBool::new(false),
            )?;
            fs::write(&path, rendered.png(640)?)?;
            fs::write(
                out.join(format!("media-{index:04}-preview.png")),
                rendered.png(1600)?,
            )?;
        }
    }
    println!("Generated 1,000 PNGs / 100 equivalent SVGs");
    Ok(())
}
