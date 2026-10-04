//! Keep Tauri's configured native controls aligned after AppKit relayouts.

use objc2_app_kit::NSView;

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
