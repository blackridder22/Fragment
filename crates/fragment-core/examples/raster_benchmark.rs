//! Identical .7/.8 release benchmark for raster processing and metadata queries.
use fragment_core::{FragmentCore, FragmentFilter};
use rusqlite::{params, Connection};
use serde_json::json;
use std::{fs, path::PathBuf, time::Instant};
fn stats(samples: &[f64]) -> serde_json::Value {
    let mut s = samples.to_vec();
    s.sort_by(f64::total_cmp);
    json!({"samplesMs":samples,"p95Ms":s[s.len()*95/100],"maxMs":s.last()})
}
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let corpus = PathBuf::from(std::env::args_os().nth(1).ok_or("corpus")?);
    let output = PathBuf::from(std::env::args_os().nth(2).ok_or("output")?);
    let temp = tempfile::tempdir()?;
    let core = FragmentCore::new_at(temp.path().to_path_buf())?;
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
        .map(|n| image::open(corpus.join(n)).map(|i| i.thumbnail(640, 640)))
        .collect::<Result<Vec<_>, _>>()?;
    let mut imports = Vec::new();
    for index in 0..100 {
        let mut im = images[index % images.len()].to_rgba8();
        im.put_pixel(0, 0, image::Rgba([index as u8, 0, 0, 255]));
        let path = temp.path().join("source.png");
        im.save(&path)?;
        let start = Instant::now();
        core.import_image(
            None,
            path.to_string_lossy().into_owned(),
            Some(format!("Benchmark {index}")),
        )?;
        imports.push(start.elapsed().as_secs_f64() * 1000.);
    }
    let red = core.import_image(
        None,
        corpus.join("solid-red.png").to_string_lossy().into_owned(),
        Some("Red".into()),
    )?;
    let mut db = Connection::open(core.paths().db_path())?;
    let tx = db.transaction()?;
    for index in 0..9899 {
        let id = format!("bench-asset-{index:05}");
        let sha = format!("bench-hash-{index:05}");
        tx.execute("INSERT INTO assets(id,original_path,thumbnail_path,preview_path,mime_type,width,height,file_size,sha256,created_at,updated_at) SELECT ?1,original_path,thumbnail_path,preview_path,mime_type,width,height,file_size,?2,created_at,updated_at FROM assets WHERE id=?3",params![id,sha,red.asset_id])?;
        tx.execute("INSERT INTO fragments(id,asset_id,frame_id,title,original_path,thumbnail_path,mime_type,width,height,file_size,sha256,captured_at,created_at,updated_at) SELECT ?1,?1,frame_id,?2,original_path,thumbnail_path,mime_type,width,height,file_size,?3,captured_at,created_at,updated_at FROM fragments WHERE id=?4",params![id,format!("Reference {index:05}"),sha,red.id])?;
    }
    tx.commit()?;
    let mut queries = Vec::new();
    for index in 0..55 {
        let start = Instant::now();
        let page = core.list_fragment_page_filtered(
            None,
            false,
            false,
            FragmentFilter::default(),
            None,
            0,
            60,
        )?;
        assert_eq!(page.1, 10000);
        std::hint::black_box(page);
        if index >= 5 {
            queries.push(start.elapsed().as_secs_f64() * 1000.);
        }
    }
    let result = json!({"version":env!("CARGO_PKG_VERSION"),"build":"release","memberships":10000,"rasterImport":stats(&imports),"unfilteredPageAndCount":stats(&queries),"limitation":"SQL clones use fixture paths; not native UI measurement"});
    fs::write(output, serde_json::to_vec_pretty(&result)?)?;
    Ok(())
}
