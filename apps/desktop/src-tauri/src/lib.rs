mod commands;
mod state;

use commands::{
    asset_data_url, asset_root, check_import_duplicate, create_frame, delete_fragment,
    delete_fragment_everywhere, delete_frame, ensure_default_frame, get_fragment, import_image,
    get_library_revision, list_all_fragments, list_child_frames, list_fragment_page,
    list_fragments, list_frames, list_trashed_fragments, load_library_snapshot,
    open_fragment_source, rename_frame, restore_fragment, reveal_fragment_in_finder, update_fragment,
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
            list_all_fragments,
            load_library_snapshot,
            list_fragment_page,
            get_library_revision,
            list_trashed_fragments,
            list_fragments,
            get_fragment,
            update_fragment,
            check_import_duplicate,
            import_image,
            delete_fragment,
            restore_fragment,
            delete_fragment_everywhere,
            reveal_fragment_in_finder,
            open_fragment_source,
            asset_data_url,
            asset_root
        ])
        .run(tauri::generate_context!())
        .expect("error while running Fragment");
}
