use fragment_core::{models::ColorFilter, FragmentCore, FragmentFilter};
use rusqlite::{params, Connection};
use std::{
    fs,
    io::Write,
    path::PathBuf,
    process::{Command, Stdio},
};

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures/media")
        .join(name)
}
fn vault() -> (tempfile::TempDir, FragmentCore) {
    let _ = fragment_core::svg_worker::configure_worker(PathBuf::from(env!(
        "CARGO_BIN_EXE_fragment-host"
    )));
    let dir = tempfile::tempdir().unwrap();
    let core = FragmentCore::new_at(dir.path().to_path_buf()).unwrap();
    (dir, core)
}
fn import(core: &FragmentCore, name: &str) -> fragment_core::Fragment {
    core.import_image(
        None,
        fixture(name).to_string_lossy().into_owned(),
        Some(name.into()),
    )
    .unwrap()
}

fn finish_one_batch(core: &FragmentCore) -> Vec<String> {
    // Other parallel tests may hold foreground permits; the scheduler deliberately yields.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        let ids = core.process_palette_batch(None, 25).unwrap();
        if !ids.is_empty() {
            return ids;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "backfill never became runnable"
        );
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

#[test]
fn worker_is_private_and_originals_palettes_and_shared_files_survive() {
    let (dir, core) = vault();
    let original = fs::read(fixture("two-color.svg")).unwrap();
    let fragment = import(&core, "two-color.svg");
    assert_eq!(fragment.mime_type.as_deref(), Some("image/svg+xml"));
    assert_eq!((fragment.width, fragment.height), (Some(640), Some(320)));
    assert_eq!(
        fs::read(
            core.paths()
                .resolve_relative_path(&fragment.original_path)
                .unwrap()
        )
        .unwrap(),
        original
    );
    assert_eq!(
        image::image_dimensions(
            core.paths()
                .resolve_relative_path(&fragment.thumbnail_path)
                .unwrap()
        )
        .unwrap(),
        (640, 320)
    );
    assert_eq!(
        image::image_dimensions(
            core.paths()
                .resolve_relative_path(fragment.preview_path.as_deref().unwrap())
                .unwrap()
        )
        .unwrap(),
        (1600, 800)
    );
    let palette = core.get_fragment_palette(&fragment.id).unwrap();
    assert_eq!(palette.status, "ready");
    assert_eq!(palette.colors.len(), 2);
    assert_eq!(palette.colors[0].hex, "#0000FF");
    assert!((palette.colors[0].coverage - 0.75).abs() < 0.02);
    let other = core.create_frame(None, "Linked SVG".into()).unwrap();
    let linked = core
        .add_existing_fragment_to_frame(fragment.id.clone(), Some(other.id))
        .unwrap();
    assert_eq!(linked.asset_id, fragment.asset_id);
    assert_eq!(
        core.get_fragment_palette(&linked.id).unwrap().colors,
        palette.colors
    );
    let preview = core
        .ensure_svg_preview(&fragment.id, 3200, "preview-1")
        .unwrap();
    let preview_path = core
        .paths()
        .resolve_relative_path(&preview.relative_path)
        .unwrap();
    let modified = fs::metadata(&preview_path).unwrap().modified().unwrap();
    let cached = core
        .ensure_svg_preview(&linked.id, 3200, "preview-2")
        .unwrap();
    assert_eq!(preview.relative_path, cached.relative_path);
    assert_eq!(
        fs::metadata(&preview_path).unwrap().modified().unwrap(),
        modified
    );
    core.delete_fragments_with_policy(std::slice::from_ref(&fragment.id), None)
        .unwrap();
    assert!(preview_path.exists());
    assert_eq!(
        core.get_fragment_palette(&linked.id).unwrap().status,
        "ready"
    );
    core.delete_fragments_with_policy(&[linked.id], None)
        .unwrap();
    assert!(!preview_path.exists());
    let conn = Connection::open(dir.path().join("fragment.db")).unwrap();
    assert_eq!(
        conn.query_row("SELECT count(*) FROM asset_palettes", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    assert_eq!(
        conn.query_row("SELECT count(*) FROM asset_preview_cache", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
}

#[test]
fn worker_rejects_resources_and_never_opens_a_database() {
    let root = tempfile::tempdir().unwrap();
    for name in [
        "external.svg",
        "network.svg",
        "entities.svg",
        "script.svg",
        "animated.svg",
        "foreign-object.svg",
        "malformed.svg",
        "html.svg",
        "nested-limit.svg",
    ] {
        let mut child = Command::new(env!("CARGO_BIN_EXE_fragment-host"))
            .arg("--render-svg")
            .env("FRAGMENT_APP_DATA_DIR", root.path().join("must-not-exist"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        child.stdin.take().unwrap().write_all(serde_json::to_string(&serde_json::json!({"input":fixture(name),"output":root.path(),"tiers":[640,1600]})).unwrap().as_bytes()).unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success());
        let result: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        assert!(result["result"]["Err"].is_object(), "{name}: {result}");
        assert!(!root.path().join("must-not-exist").exists());
    }
}

#[test]
fn svg_corpus_alpha_text_limits_and_repair() {
    let (_dir, core) = vault();
    for name in [
        "transparent-logo.svg",
        "gradient-mask.svg",
        "filter-clip.svg",
        "embedded.svg",
        "huge-viewport.svg",
        "text.svg",
        "missing-font.svg",
    ] {
        let fragment = import(&core, name);
        assert!(
            core.get_fragment_palette(&fragment.id)
                .unwrap()
                .colors
                .len()
                <= 6
        );
        if name == "transparent-logo.svg" {
            let image = image::open(
                core.paths()
                    .resolve_relative_path(&fragment.thumbnail_path)
                    .unwrap(),
            )
            .unwrap()
            .to_rgba8();
            let pixel = image.get_pixel(320, 160).0;
            assert_eq!(pixel[0], 255);
            assert!((i16::from(pixel[1]) - 128).abs() <= 1);
            assert!(pixel[3] >= 127 && pixel[3] <= 128);
        }
        if name == "missing-font.svg" {
            assert_eq!(
                core.fragment_media_info(&fragment.id).unwrap().warnings[0].code,
                "font_substitution"
            );
        }
        if name == "huge-viewport.svg" {
            let path = core
                .paths()
                .resolve_relative_path(fragment.preview_path.as_deref().unwrap())
                .unwrap();
            assert_eq!(image::image_dimensions(&path).unwrap(), (1600, 1600));
            fs::write(&path, b"broken").unwrap();
            core.ensure_svg_preview(&fragment.id, 1600, "repair")
                .unwrap();
            assert_eq!(image::image_dimensions(path).unwrap(), (1600, 1600));
        }
    }
}

#[test]
fn color_filters_cover_unloaded_memberships_and_smart_frames() {
    let (dir, core) = vault();
    let red = import(&core, "solid-red.png");
    let blue = import(&core, "two-color.png");
    let parent = core.create_frame(None, "Color scope".into()).unwrap();
    let mut expected = vec![red.id.clone()];
    for index in 0..65 {
        let frame = core
            .create_frame(Some(parent.id.clone()), format!("Frame {index:03}"))
            .unwrap();
        expected.push(
            core.add_existing_fragment_to_frame(red.id.clone(), Some(frame.id))
                .unwrap()
                .id,
        );
    }
    let filter = FragmentFilter {
        color: Some(ColorFilter {
            hex: "#FF0000".into(),
            tolerance: 10,
        }),
        ..Default::default()
    };
    for sort in ["newest", "oldest", "name", "largest"] {
        let first = core
            .list_fragment_page_snapshot(
                None,
                false,
                false,
                filter.clone(),
                Some(sort.into()),
                0,
                60,
            )
            .unwrap();
        let second = core
            .list_fragment_page_snapshot(
                None,
                false,
                false,
                filter.clone(),
                Some(sort.into()),
                60,
                60,
            )
            .unwrap();
        let ids = core
            .list_fragment_ids_filtered(None, false, false, filter.clone(), Some(sort.into()))
            .unwrap();
        assert_eq!(first.total, 66);
        assert_eq!(first.palette_revision, second.palette_revision);
        assert_eq!(
            first
                .items
                .iter()
                .chain(&second.items)
                .map(|f| f.id.clone())
                .collect::<Vec<_>>(),
            ids
        );
        assert!(!ids.contains(&blue.id));
    }
    let (_, total) = core
        .list_fragment_page_filtered(Some(parent.id), true, false, filter.clone(), None, 0, 60)
        .unwrap();
    assert_eq!(total, 65);
    let saved = core
        .create_smart_frame("Red references".into(), filter.clone())
        .unwrap();
    assert_eq!(core.list_smart_frames().unwrap()[0].filter, saved.filter);
    let bad = FragmentFilter {
        color: Some(ColorFilter {
            hex: "#ff0000".into(),
            tolerance: 80,
        }),
        ..Default::default()
    };
    assert!(core.create_smart_frame("Bad".into(), bad).is_err());
    let conn = Connection::open(dir.path().join("fragment.db")).unwrap();
    assert!(conn
        .prepare("PRAGMA foreign_key_check")
        .unwrap()
        .query([])
        .unwrap()
        .next()
        .unwrap()
        .is_none());
}

#[test]
fn backfill_restarts_without_revising_gallery_and_terminal_failure_retries() {
    let (dir, core) = vault();
    let fragment = import(&core, "solid-red.png");
    let conn = Connection::open(dir.path().join("fragment.db")).unwrap();
    conn.execute("DELETE FROM asset_palette_colors", [])
        .unwrap();
    conn.execute("DELETE FROM asset_palettes", []).unwrap();
    let library_revision = core.library_revision().unwrap();
    let before = core.palette_index_status().unwrap();
    assert_eq!(before.pending, 1);
    assert_eq!(finish_one_batch(&core).len(), 1);
    assert_eq!(core.library_revision().unwrap(), library_revision);
    // The backfill samples the stored thumbnail, which is lossy WebP since
    // v0.0.9, so a pure channel may land one step off (#FF0000 -> #FF0100).
    let dominant = &core.get_fragment_palette(&fragment.id).unwrap().colors[0];
    assert!(
        dominant.r == 255 && dominant.g <= 1 && dominant.b <= 1,
        "dominant colour should be red, got {}",
        dominant.hex
    );
    assert_ne!(
        core.palette_index_status().unwrap().revision,
        before.revision
    );
    assert!(core.process_palette_batch(None, 25).unwrap().is_empty());
    conn.execute("UPDATE asset_palettes SET status='processing',lease_token='dead-worker',lease_expires_at=0",[]).unwrap();
    let reopened = FragmentCore::new_at(dir.path().to_path_buf()).unwrap();
    assert_eq!(finish_one_batch(&reopened).len(), 1);
    fs::remove_file(
        core.paths()
            .resolve_relative_path(&fragment.thumbnail_path)
            .unwrap(),
    )
    .unwrap();
    conn.execute("UPDATE asset_palettes SET status='pending',attempts=0", [])
        .unwrap();
    for _ in 0..3 {
        finish_one_batch(&core);
        conn.execute("UPDATE asset_palettes SET next_retry_at=0", [])
            .unwrap();
    }
    assert_eq!(
        core.get_fragment_palette(&fragment.id).unwrap().status,
        "failed"
    );
    assert!(core.process_palette_batch(None, 25).unwrap().is_empty());
    core.retry_fragment_palette(&fragment.id).unwrap();
    assert_eq!(
        core.get_fragment_palette(&fragment.id).unwrap().status,
        "pending"
    );
    assert_eq!(
        conn.query_row(
            "SELECT attempts FROM asset_palettes WHERE asset_id=?1",
            params![fragment.asset_id],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
}

#[test]
fn schema_four_upgrade_preserves_data_and_rolls_back_on_failure() {
    let (dir, core) = vault();
    let fragment = import(&core, "solid-red.png");
    let path = core
        .paths()
        .resolve_relative_path(&fragment.original_path)
        .unwrap();
    let bytes = fs::read(path).unwrap();
    drop(core);
    let db = Connection::open(dir.path().join("fragment.db")).unwrap();
    // Undo migrations 7, 6 and 5 so the database is a genuine schema-4 Vault.
    db.execute_batch("ALTER TABLE pending_file_deletions DROP COLUMN deferred_until_relaunch; DROP TABLE asset_derivative_jobs; DROP INDEX idx_assets_derivatives_version; ALTER TABLE assets DROP COLUMN derivatives_version; DROP TABLE asset_palette_colors; DROP TABLE asset_palettes; DROP TABLE asset_preview_cache; ALTER TABLE assets DROP COLUMN render_warnings_json; ALTER TABLE vault_metadata DROP COLUMN palette_revision; PRAGMA user_version=4;").unwrap();
    // Force the middle of migration 5 to fail, proving its earlier ALTERs roll back.
    db.execute_batch("CREATE TABLE asset_palettes(blocker TEXT);")
        .unwrap();
    assert!(FragmentCore::new_at(dir.path().to_path_buf()).is_err());
    assert_eq!(
        db.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        4
    );
    assert!(db
        .prepare("SELECT render_warnings_json FROM assets")
        .is_err());
    db.execute_batch("DROP TABLE asset_palettes;").unwrap();
    let upgraded = FragmentCore::new_at(dir.path().to_path_buf()).unwrap();
    assert_eq!(upgraded.schema_version().unwrap(), 7);
    assert_eq!(
        upgraded.get_fragment(fragment.id.clone()).unwrap(),
        fragment
    );
    // Migration 6 marks pre-existing assets for background regeneration.
    assert_eq!(
        db.query_row(
            "SELECT derivatives_version FROM assets WHERE id = ?1",
            params![fragment.asset_id],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        1
    );
    assert_eq!(upgraded.derivatives_status().unwrap().pending, 1);
    assert_eq!(
        fs::read(
            upgraded
                .paths()
                .resolve_relative_path(&fragment.original_path)
                .unwrap()
        )
        .unwrap(),
        bytes
    );
    assert_eq!(upgraded.palette_index_status().unwrap().pending, 1);
    assert_eq!(finish_one_batch(&upgraded).len(), 1);
    assert!(db
        .prepare("PRAGMA foreign_key_check")
        .unwrap()
        .query([])
        .unwrap()
        .next()
        .unwrap()
        .is_none());
}

#[test]
fn concurrent_svg_imports_have_one_asset_and_no_orphans() {
    let (dir, core) = vault();
    let a = core.create_frame(None, "A".into()).unwrap();
    let b = core.create_frame(None, "B".into()).unwrap();
    let source = fixture("two-color.svg").to_string_lossy().into_owned();
    let gate = std::sync::Arc::new(std::sync::Barrier::new(2));
    let other = core.clone();
    let other_gate = gate.clone();
    let other_source = source.clone();
    let thread = std::thread::spawn(move || {
        other_gate.wait();
        other
            .import_image_outcome(Some(a.id), other_source, None)
            .unwrap()
    });
    gate.wait();
    core.import_image_outcome(Some(b.id), source, None).unwrap();
    thread.join().unwrap();
    let db = Connection::open(dir.path().join("fragment.db")).unwrap();
    assert_eq!(
        db.query_row("SELECT count(*) FROM assets", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(core.list_all_fragments().unwrap().len(), 2);
    assert_eq!(
        fs::read_dir(core.paths().thumbnails_dir()).unwrap().count(),
        1
    );
    assert_eq!(
        fs::read_dir(core.paths().previews_dir()).unwrap().count(),
        1
    );
    assert_eq!(fs::read_dir(core.paths().temp_dir()).unwrap().count(), 0);
}

#[test]
fn color_revision_combined_filters_and_trash_remain_consistent() {
    let (dir, core) = vault();
    let red = import(&core, "solid-red.png");
    let conn = Connection::open(dir.path().join("fragment.db")).unwrap();
    conn.execute("UPDATE fragments SET title='Red identity',source_url='https://example.com/art/red.svg' WHERE id=?1", params![red.id]).unwrap();
    core.set_fragment_tags(red.id.clone(), vec!["Brand".into()])
        .unwrap();
    let filter = FragmentFilter {
        color: Some(ColorFilter {
            hex: "#FF0000".into(),
            tolerance: 0,
        }),
        query: Some("identity".into()),
        tags: vec!["brand".into()],
        mime_types: vec!["image/png".into()],
        source_domain: Some("example.com".into()),
        source_kind: Some("source".into()),
        ..Default::default()
    };
    // Two swatches satisfying the predicate still represent one membership.
    conn.execute("INSERT INTO asset_palette_colors SELECT asset_id,1,r,g,b,l,a,lab_b,coverage FROM asset_palette_colors WHERE asset_id=?1 AND rank=0",params![red.asset_id]).unwrap();
    let first = core
        .list_fragment_page_snapshot(None, false, false, filter.clone(), None, 0, 60)
        .unwrap();
    assert_eq!(first.total, 1);
    assert_eq!(
        core.list_fragment_ids_at_revision(
            None,
            false,
            false,
            filter.clone(),
            None,
            Some(first.palette_revision.clone())
        )
        .unwrap(),
        vec![red.id.clone()]
    );
    conn.execute(
        "UPDATE vault_metadata SET palette_revision=palette_revision+1",
        [],
    )
    .unwrap();
    assert!(core
        .list_fragment_ids_at_revision(
            None,
            false,
            false,
            filter.clone(),
            None,
            Some(first.palette_revision)
        )
        .unwrap_err()
        .to_string()
        .contains("Refresh"));
    core.delete_fragment_with_policy(red.id.clone(), Some(30))
        .unwrap();
    assert_eq!(
        core.list_fragment_page_snapshot(None, false, false, filter.clone(), None, 0, 60)
            .unwrap()
            .total,
        0
    );
    for sort in ["deleted", "deleted-oldest", "name", "largest"] {
        let trash = core
            .list_fragment_page_snapshot(
                None,
                false,
                true,
                filter.clone(),
                Some(sort.into()),
                0,
                60,
            )
            .unwrap();
        assert_eq!(trash.total, 1);
        assert_eq!(trash.items[0].id, red.id);
    }
    conn.execute("UPDATE asset_palettes SET status='failed'", [])
        .unwrap();
    assert_eq!(
        core.list_fragment_page_snapshot(None, false, true, filter, None, 0, 60)
            .unwrap()
            .total,
        0
    );
    assert!(serde_json::from_str::<FragmentFilter>(
        r##"{"color":{"hex":"#FFFFFF","tolerance":201}}"##
    )
    .unwrap()
    .color
    .unwrap()
    .lab()
    .is_err());
    assert!(serde_json::from_str::<FragmentFilter>(
        r##"{"color":{"hex":"#FFFFFF","tolerance":0.5}}"##
    )
    .is_err());
    assert!(serde_json::from_str::<FragmentFilter>("{\"tags\":[]}")
        .unwrap()
        .color
        .is_none());
}

#[test]
fn cancellation_before_preview_dispatch_does_not_render_or_cache() {
    let (dir, core) = vault();
    let svg = import(&core, "two-color.svg");
    let id = format!("cancel-{}", svg.id);
    fragment_core::previews::cancel_preview(&id);
    let err = core.ensure_svg_preview(&svg.id, 3200, &id).unwrap_err();
    assert!(matches!(
        err,
        fragment_core::CoreError::Svg(fragment_core::svg::SvgError {
            code: fragment_core::svg::SvgErrorCode::SvgCancelled,
            ..
        })
    ));
    let conn = Connection::open(dir.path().join("fragment.db")).unwrap();
    assert_eq!(
        conn.query_row("SELECT count(*) FROM asset_preview_cache", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        0
    );
    core.ensure_svg_preview(&svg.id, 3200, &format!("next-{}", svg.id))
        .unwrap();
}

#[test]
fn repeated_embedded_images_and_failed_preparation_leave_no_assets() {
    let (dir, core) = vault();
    let source = fs::read_to_string(fixture("embedded.svg")).unwrap();
    let image_start = source.find("<image").unwrap();
    let image_end = source[image_start..].find("/>").unwrap() + image_start + 2;
    let image = source[image_start..image_end].replacen("<image", "<image id='i'", 1);
    let svg = format!("<svg xmlns='http://www.w3.org/2000/svg' width='640' height='320'><defs>{image}</defs>{}</svg>","<use href='#i'/>".repeat(157));
    let path = dir.path().join("over-budget.svg");
    fs::write(&path, svg).unwrap();
    let result = core.import_image(None, path.to_string_lossy().into_owned(), None);
    assert!(matches!(
        result,
        Err(fragment_core::CoreError::Svg(
            fragment_core::svg::SvgError {
                code: fragment_core::svg::SvgErrorCode::UnsupportedSvg,
                ..
            }
        ))
    ));
    assert!(core.list_all_fragments().unwrap().is_empty());
    assert_eq!(fs::read_dir(core.paths().temp_dir()).unwrap().count(), 0);
    // A real filesystem error after validation must not create a membership or leave temp files.
    let originals = dir.path().join("originals");
    fs::remove_dir(&originals).unwrap();
    fs::write(&originals, b"not a directory").unwrap();
    assert!(core
        .import_image(
            None,
            fixture("two-color.svg").to_string_lossy().into_owned(),
            None
        )
        .is_err());
    assert!(core.list_all_fragments().unwrap().is_empty());
    assert_eq!(fs::read_dir(core.paths().temp_dir()).unwrap().count(), 0);
    assert_eq!(
        fs::read_dir(dir.path().join("thumbnails")).unwrap().count(),
        0
    );
    assert_eq!(
        fs::read_dir(dir.path().join("previews")).unwrap().count(),
        0
    );
}
