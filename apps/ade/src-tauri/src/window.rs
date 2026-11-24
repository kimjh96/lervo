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

/// How recent the last left mouse press must be for an activation to count as a click.
#[cfg(target_os = "macos")]
const CLICK_WINDOW_SECONDS: f64 = 0.5;

/// Reports a click that brought the window forward. WebKit spends that click on activating the
/// window and never shows it to the page, so the page replays it (ADE design patterns, "The first
/// click acts"). It counts as a click when the left button went down within the last half second
/// and the pointer is over the window's content: a quick click is often released before the window
/// becomes key, and Command-Tab or a click in the Dock leave the pointer elsewhere or no press.
pub fn on_window_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
    if !matches!(event, WindowEvent::Focused(true)) || !clicked_just_now() {
        return;
    }
    let (Ok(cursor), Ok(origin), Ok(size), Ok(scale)) = (
        window.cursor_position(),
        window.inner_position(),
        window.inner_size(),
        window.scale_factor(),
    ) else {
        return;
    };
    let (dx, dy) = (
        cursor.x - f64::from(origin.x),
        cursor.y - f64::from(origin.y),
    );
    if dx < 0.0 || dy < 0.0 || dx >= f64::from(size.width) || dy >= f64::from(size.height) {
        return;
    }
    let _ = window.emit(
        ACTIVATED_BY_CLICK,
        json!({ "x": dx / scale, "y": dy / scale }),
    );
}

/// Whether the left mouse button went down within `CLICK_WINDOW_SECONDS`.
#[cfg(target_os = "macos")]
fn clicked_just_now() -> bool {
    use objc2_core_graphics::{CGEventSource, CGEventSourceStateID, CGEventType};
    CGEventSource::seconds_since_last_event_type(
        CGEventSourceStateID::CombinedSessionState,
        CGEventType::LeftMouseDown,
    ) < CLICK_WINDOW_SECONDS
}

/// Elsewhere a click that activates a window reaches the page, so nothing needs replaying.
#[cfg(not(target_os = "macos"))]
fn clicked_just_now() -> bool {
    false
}
