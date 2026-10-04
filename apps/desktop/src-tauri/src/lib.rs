mod commands;
mod media_commands;
mod native_host;
mod state;
#[cfg(target_os = "macos")]
mod window_chrome;

use media_commands::*;
use tauri::Manager;

use commands::{
    add_existing_fragment_to_frame, asset_data_url, asset_root, cancel_import_job,
    copy_fragment_image, create_frame, create_smart_frame, delete_fragment,
    delete_fragment_everywhere, delete_fragments, delete_frame, delete_smart_frame, empty_trash,
    ensure_default_frame, fragment_membership_count, get_fragment, get_fragment_any,
    get_fragment_tags, get_library_revision, hard_delete_frame, import_image, import_image_batch,
    list_all_fragments, list_child_frames, list_fragment_ids, list_fragment_page, list_fragments,
    list_frames, list_smart_frames, list_tags, list_trashed_fragments, list_trashed_frames,
    load_library_snapshot, move_fragment_to_frame, move_frame, native_host_status,
    open_fragment_source, purge_expired_trash, rename_frame, restore_fragment, restore_fragments,
    restore_frame, reveal_fragment_in_finder, reveal_vault_in_finder, set_fragment_tags,
    update_fragment, update_smart_frame,
};
use state::FragmentState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // INFO by default; `RUST_LOG=fragment_desktop_lib=debug,fragment_core=debug`
    // exposes the background-worker wake/idle trace without rebuilding.
    tracing_subscriber::fmt()
        .with_target(false)
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let state = FragmentState::new().expect("failed to initialize Fragment core");

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .on_page_load(|webview, payload| {
            #[cfg(target_os = "macos")]
            if payload.event() == tauri::webview::PageLoadEvent::Finished {
                window_chrome::refresh(webview);
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (webview, payload);
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Focused(true)) {
                // Returning to the app is the usual moment browser captures become visible.
                window
                    .app_handle()
                    .state::<FragmentState>()
                    .palette_waker
                    .notify("focus");
            }
            #[cfg(target_os = "macos")]
            match event {
                // Focus and theme changes are rare and must realign the controls at once.
                tauri::WindowEvent::Focused(true) | tauri::WindowEvent::ThemeChanged(_) => {
                    if let Some(webview) = window.get_webview_window(window.label()) {
                        window_chrome::refresh(webview.as_ref());
                    }
                }
                // Resize events arrive continuously during a drag; refresh once they settle.
                tauri::WindowEvent::Resized(_) => {
                    if let Some(webview) = window.get_webview_window(window.label()) {
                        window_chrome::refresh_after_resize(webview);
                    }
                }
                _ => {}
            }
        })
        .setup(|app| {
            // Scope only the configured Vault, including isolated QA roots.
            app.asset_protocol_scope().allow_directory(app.state::<FragmentState>().core.paths().root(),true)?;
            // Regenerate legacy PNG derivatives once first paint has had the machine to itself.
            media_commands::start_derivative_regeneration(
                app.handle().clone(),
                &app.state::<FragmentState>(),
                media_commands::DERIVATIVES_START_DELAY,
            );
            if let Ok(resources)=app.path().resource_dir(){
                let worker=resources.join("fragment-host");
                if worker.is_file(){let _=fragment_core::svg_worker::configure_worker(worker);}
            }
            #[cfg(target_os = "macos")]
            if std::env::var_os("FRAGMENT_APP_DATA_DIR").is_none() {
            match app.path().resource_dir() {
                Ok(resource_dir) => {
                    if let Err(error) = native_host::install_bundled_native_host(&resource_dir) {
                        tracing::warn!(
                            %error,
                            "Chrome native-host auto-install did not complete; Fragment will continue without browser capture"
                        );
                    }
                }
                Err(error) => {
                    tracing::warn!(
                        %error,
                        "Chrome native-host auto-install could not locate bundled resources; Fragment will continue without browser capture"
                    );
                }
            }
            }
            Ok(())
        })
        .manage(state)
        .invoke_handler(tauri::generate_handler![
            start_palette_indexing,
            set_palette_priority,
            get_fragment_palette,
            get_palette_index_status,
            retry_fragment_palette,
            get_fragment_media_info,
            ensure_svg_preview,
            cancel_svg_preview,
            derivatives_status,
            ensure_default_frame,
            create_frame,
            list_frames,
            list_child_frames,
            rename_frame,
            move_frame,
            delete_frame,
            hard_delete_frame,
            list_trashed_frames,
            restore_frame,
            purge_expired_trash,
            empty_trash,
            list_all_fragments,
            load_library_snapshot,
            list_fragment_page,
            list_fragment_ids,
            list_smart_frames,
            create_smart_frame,
            update_smart_frame,
            delete_smart_frame,
            fragment_membership_count,
            get_library_revision,
            list_trashed_fragments,
            list_fragments,
            get_fragment,
            get_fragment_any,
            get_fragment_tags,
            list_tags,
            set_fragment_tags,
            add_existing_fragment_to_frame,
            move_fragment_to_frame,
            update_fragment,
            import_image,
            import_image_batch,
            cancel_import_job,
            delete_fragment,
            restore_fragment,
            delete_fragment_everywhere,
            delete_fragments,
            restore_fragments,
            reveal_fragment_in_finder,
            reveal_vault_in_finder,
            open_fragment_source,
            copy_fragment_image,
            asset_data_url,
            asset_root,
            native_host_status
        ])
        .build(tauri::generate_context!())
        .expect("error while building Fragment")
        .run(|app,event|{
            if matches!(event,tauri::RunEvent::ExitRequested{..}) {
                let state = app.state::<FragmentState>();
                state.background_stopped.store(true,std::sync::atomic::Ordering::Release);
                state.palette_waker.notify("exit");
                fragment_core::svg_worker::shutdown_worker();
            }
        });
}
