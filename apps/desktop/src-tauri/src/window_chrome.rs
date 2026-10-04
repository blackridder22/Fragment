//! Keep Tauri's configured native controls aligned after AppKit relayouts.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

use objc2_app_kit::NSView;

/// Resize events arrive at display rate during a drag. One refresh this long
/// after the last event is enough to realign the traffic lights.
pub(super) const RESIZE_SETTLE: Duration = Duration::from_millis(150);
static RESIZE_GENERATION: AtomicU64 = AtomicU64::new(0);
static RESIZE_PENDING: AtomicBool = AtomicBool::new(false);

pub(super) fn refresh(webview: &tauri::Webview) {
    if webview.label() != "main" || webview.window().is_fullscreen().unwrap_or(true) {
        return;
    }

    if let Err(error) = webview.with_webview(|platform| {
        // SAFETY: Tauri runs this callback on the main thread and keeps the
        // WKWebView alive for its duration. WKWebView is an NSView subclass;
        // neither this borrowed reference nor its parent escapes the callback.
        let parent = unsafe { (&*platform.inner().cast::<NSView>()).superview() };
        if let Some(parent) = parent {
            // Wry's parent reapplies trafficLightPosition in drawRect. AppKit
            // can reset it on activation/fullscreen changes without a redraw.
            // https://github.com/tauri-apps/tauri/issues/15451
            parent.setNeedsDisplay(true);
            parent.displayIfNeeded();
        }
    }) {
        tracing::warn!(%error, "could not refresh native window controls");
    }
}

/// Coalesces a burst of resize events into one `refresh` after [`RESIZE_SETTLE`].
/// `refresh` dispatches its AppKit work to the main thread itself, so the
/// settle timer runs on a short-lived helper thread.
pub(super) fn refresh_after_resize(webview: tauri::WebviewWindow) {
    RESIZE_GENERATION.fetch_add(1, Ordering::AcqRel);
    if RESIZE_PENDING.swap(true, Ordering::AcqRel) {
        return;
    }
    std::thread::spawn(move || {
        loop {
            let seen = RESIZE_GENERATION.load(Ordering::Acquire);
            std::thread::sleep(RESIZE_SETTLE);
            if RESIZE_GENERATION.load(Ordering::Acquire) != seen {
                continue;
            }
            RESIZE_PENDING.store(false, Ordering::Release);
            // An event that lands here sees PENDING == false and starts a new timer.
            tracing::debug!("refreshing window controls after resize settled");
            refresh(webview.as_ref());
            return;
        }
    });
}
