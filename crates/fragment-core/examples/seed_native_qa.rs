//! Seed an isolated Fragment library for native pagination and Trash QA.
//!
//! Usage:
//! `cargo run -p fragment-core --example seed_native_qa -- /absolute/empty/fixture/root`

use std::{
    env,
    error::Error,
    ffi::OsString,
    fs,
    io::{self, ErrorKind},
    path::{Path, PathBuf},
};

use fragment_core::FragmentCore;
use image::{ImageFormat, Rgba, RgbaImage};

const ACTIVE_IMAGE_COUNT: usize = 72;
const TRASHED_IMAGE_COUNT: usize = 72;
const TRASH_RETENTION_DAYS: u32 = 31;

fn main() -> Result<(), Box<dyn Error>> {
    let root = required_empty_root(env::args_os())?;
    eprintln!("Seeding isolated Fragment QA fixture at {}", root.display());

    let core = FragmentCore::new_at(root.clone())?;
    let active_frame = core.create_frame(None, "QA Active Images".to_string())?;
    let trash_frame = core.create_frame(None, "QA Trashed Images".to_string())?;

    let staging_dir = root.join("fixture-source");
    fs::create_dir(&staging_dir)?;
    let source_path = staging_dir.join("source.png");

    for index in 0..ACTIVE_IMAGE_COUNT {
        write_unique_png(&source_path, index)?;
        core.import_image(
            Some(active_frame.id.clone()),
            utf8_path(&source_path)?,
            Some(format!("QA Active Image {:03}", index + 1)),
        )?;
    }

    let mut trashed_ids = Vec::with_capacity(TRASHED_IMAGE_COUNT);
    for index in 0..TRASHED_IMAGE_COUNT {
        let unique_index = ACTIVE_IMAGE_COUNT + index;
        write_unique_png(&source_path, unique_index)?;
        let fragment = core.import_image(
            Some(trash_frame.id.clone()),
            utf8_path(&source_path)?,
            Some(format!("QA Trashed Image {:03}", index + 1)),
        )?;
        trashed_ids.push(fragment.id);
    }

    let trashed = core.delete_fragments_with_policy(&trashed_ids, Some(TRASH_RETENTION_DAYS))?;
    fs::remove_file(&source_path)?;
    fs::remove_dir(&staging_dir)?;

    let active_count = core.list_all_fragments()?.len();
    let trashed_count = core.list_trashed_fragments()?.len();
    if active_count != ACTIVE_IMAGE_COUNT
        || trashed_count != TRASHED_IMAGE_COUNT
        || trashed != TRASHED_IMAGE_COUNT
    {
        return Err(io::Error::other(format!(
            "fixture verification failed: expected {ACTIVE_IMAGE_COUNT} active and \
             {TRASHED_IMAGE_COUNT} trashed, found {active_count} active and \
             {trashed_count} trashed ({trashed} newly trashed)"
        ))
        .into());
    }

    println!("Fixture root: {}", root.display());
    println!("Active Fragments/images: {active_count}");
    println!("Trashed Fragments/images: {trashed_count}");
    println!("Cleanup: delete only this fixture root when QA is complete.");
    println!("  {}", root.display());

    Ok(())
}

fn required_empty_root(args: impl IntoIterator<Item = OsString>) -> io::Result<PathBuf> {
    let mut args = args.into_iter();
    let program = args
        .next()
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("seed_native_qa"));
    let root = args.next().map(PathBuf::from).ok_or_else(|| {
        io::Error::new(
            ErrorKind::InvalidInput,
            format!(
                "an explicit app-data root is required; usage: {} \
                 /absolute/empty/fixture/root",
                program.display()
            ),
        )
    })?;

    if args.next().is_some() {
        return Err(io::Error::new(
            ErrorKind::InvalidInput,
            "expected exactly one app-data root argument",
        ));
    }
    if !root.is_absolute() {
        return Err(io::Error::new(
            ErrorKind::InvalidInput,
            "the fixture app-data root must be an absolute path",
        ));
    }
    if root.exists() {
        let metadata = fs::symlink_metadata(&root)?;
        if metadata.file_type().is_symlink() {
            return Err(io::Error::new(
                ErrorKind::InvalidInput,
                "the fixture app-data root must not be a symbolic link",
            ));
        }
        if !metadata.is_dir() {
            return Err(io::Error::new(
                ErrorKind::InvalidInput,
                "the fixture app-data root must be a directory",
            ));
        }
        if fs::read_dir(&root)?.next().transpose()?.is_some() {
            return Err(io::Error::new(
                ErrorKind::AlreadyExists,
                "the fixture app-data root must be empty",
            ));
        }
    }

    Ok(root)
}

fn write_unique_png(path: &Path, index: usize) -> Result<(), image::ImageError> {
    let index = u32::try_from(index).map_err(|_| {
        image::ImageError::IoError(io::Error::new(
            ErrorKind::InvalidInput,
            "fixture image index exceeds u32",
        ))
    })?;
    let mut image = RgbaImage::new(8, 8);
    for (x, y, pixel) in image.enumerate_pixels_mut() {
        let red = index.to_le_bytes()[0];
        let green = index.to_le_bytes()[1];
        let blue = (index + x * 31 + y * 17).to_le_bytes()[0];
        *pixel = Rgba([red, green, blue, u8::MAX]);
    }
    image.save_with_format(path, ImageFormat::Png)
}

fn utf8_path(path: &Path) -> io::Result<String> {
    path.to_str().map(str::to_owned).ok_or_else(|| {
        io::Error::new(
            ErrorKind::InvalidInput,
            "fixture source path must contain valid UTF-8",
        )
    })
}
