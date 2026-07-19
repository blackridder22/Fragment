mod commands;
mod state;

use commands::{
    add_existing_fragment_to_frame, asset_data_url, asset_root, cancel_import_job,
    check_import_duplicate, create_frame, delete_fragment, delete_fragment_everywhere,
    delete_fragments, delete_frame, ensure_default_frame, fragment_membership_count, get_fragment,
    get_fragment_any, get_library_revision, hard_delete_frame, import_image, import_image_batch,
    list_all_fragments, list_child_frames, list_fragment_ids, list_fragment_page, list_fragments,
    list_frames, list_trashed_fragments, list_trashed_frames, load_library_snapshot,
    open_fragment_source, purge_expired_trash, rename_frame, restore_fragment, restore_fragments,
    restore_frame, reveal_fragment_in_finder, update_fragment,
};
use state::FragmentState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt().with_target(false).init();

    let state = FragmentState::new().expect("failed to initialize Fragment core");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            ensure_default_frame,
            create_frame,
            list_frames,
            list_child_frames,
            rename_frame,
            delete_frame,
            hard_delete_frame,
            list_trashed_frames,
            restore_frame,
            purge_expired_trash,
            list_all_fragments,
            load_library_snapshot,
            list_fragment_page,
            list_fragment_ids,
            fragment_membership_count,
            get_library_revision,
            list_trashed_fragments,
            list_fragments,
            get_fragment,
            get_fragment_any,
            add_existing_fragment_to_frame,
            update_fragment,
            check_import_duplicate,
            import_image,
            import_image_batch,
            cancel_import_job,
            delete_fragment,
            restore_fragment,
            delete_fragment_everywhere,
            delete_fragments,
            restore_fragments,
            reveal_fragment_in_finder,
            open_fragment_source,
            asset_data_url,
            asset_root
        ])
        .run(tauri::generate_context!())
        .expect("error while running Fragment");
}
