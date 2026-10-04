//! Portable across .7/.8. Only use an explicit empty QA Vault.
use fragment_core::FragmentCore;
use std::{fs, path::PathBuf};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let sources = PathBuf::from(std::env::args_os().nth(1).ok_or("sources")?);
    let root = PathBuf::from(std::env::args_os().nth(2).ok_or("empty QA root")?);
    let mixed = std::env::args().nth(3).as_deref() == Some("mixed");
    if !root.is_absolute() || (root.exists() && fs::read_dir(&root)?.next().is_some()) {
        return Err("An absolute empty QA root is required".into());
    }
    let core = FragmentCore::new_at(root)?;
    let frame = core.create_frame(None, "Media QA 1000".into())?;
    for index in 0..1000 {
        let ext = if mixed && index % 10 == 0 {
            "svg"
        } else {
            "png"
        };
        core.import_image(
            Some(frame.id.clone()),
            sources
                .join(format!("media-{index:04}.{ext}"))
                .to_string_lossy()
                .into_owned(),
            Some(format!("Media {index:04}")),
        )?;
    }
    assert_eq!(core.list_all_fragments()?.len(), 1000);
    println!(
        "{}: 1,000 real assets in {}",
        env!("CARGO_PKG_VERSION"),
        frame.id
    );
    Ok(())
}
