//! The window opens hidden (`tauri.conf.json`) and shows once its page can paint the launch view,
//! so it never shows an empty window while the webview starts (ADE motion, "Launch").

use tauri::webview::{PageLoadEvent, PageLoadPayload};
use tauri::{Runtime, Webview, WebviewWindow, Window};

/// Shows the window. `public/launch.js` calls it as soon as the document's stylesheets have
/// loaded, which is when the launch view can paint.
#[tauri::command]
pub fn window_ready(window: WebviewWindow) {
    show(window.as_ref().window());
}

/// Shows the window when its page has finished loading, in case the page never asked.
pub fn on_page_load<R: Runtime>(webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
    if payload.event() == PageLoadEvent::Finished {
        show(webview.window());
    }
}

/// Shows and focuses a hidden window; a visible window keeps its place and focus.
fn show<R: Runtime>(window: Window<R>) {
    if window.is_visible().unwrap_or(false) {
        return;
    }
    if window.show().is_ok() {
        let _ = window.set_focus();
    }
}
