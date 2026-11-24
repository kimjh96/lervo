//! The window opens hidden (`tauri.conf.json`) and shows once its page can paint the launch view,
//! so it never shows an empty window while the webview starts (ADE motion, "Launch").

use serde_json::json;
use tauri::webview::{PageLoadEvent, PageLoadPayload};
use tauri::{Emitter, Runtime, Webview, WebviewWindow, Window, WindowEvent};

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

/// The page event that reports a click which brought the window forward, at its place in the
/// page's coordinates.
pub const ACTIVATED_BY_CLICK: &str = "lervo:activated-by-click";

/// Reports a click that brought the window forward. WebKit spends that click on activating the
/// window and never shows it to the page, so the page replays it (ADE design patterns, "The first
/// click acts"). The left button still being down when the window becomes key tells a click from
/// Command-Tab or a click in the Dock.
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if !matches!(event, WindowEvent::Focused(true)) || !left_button_down() {
        return;
    }
    let (Ok(cursor), Ok(origin), Ok(scale)) = (
        window.cursor_position(),
        window.inner_position(),
        window.scale_factor(),
    ) else {
        return;
    };
    let x = (cursor.x - f64::from(origin.x)) / scale;
    let y = (cursor.y - f64::from(origin.y)) / scale;
    let _ = window.emit(ACTIVATED_BY_CLICK, json!({ "x": x, "y": y }));
}

/// Whether the left mouse button is down now.
#[cfg(target_os = "macos")]
fn left_button_down() -> bool {
    objc2_app_kit::NSEvent::pressedMouseButtons() & 1 == 1
}

/// Elsewhere a click that activates a window reaches the page, so nothing needs replaying.
#[cfg(not(target_os = "macos"))]
fn left_button_down() -> bool {
    false
}
