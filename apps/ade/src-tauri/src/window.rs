//! The window opens hidden (`tauri.conf.json`) and shows once its page has painted the launch
//! view, so it never shows an empty window while the webview starts (ADE motion, "Launch").
//!
//! WebKit draws nothing for a window that is not on screen, so a window shown when its page could
//! paint still showed its bare material until the first frame landed, for seconds when the Mac
//! was short of memory. The window therefore goes on screen fully transparent, so WebKit draws
//! into it, and turns opaque when the page reports its first frame, or after a bound.

use serde_json::json;
use tauri::webview::{PageLoadEvent, PageLoadPayload};
use tauri::{Emitter, Runtime, Webview, WebviewWindow, Window, WindowEvent};

/// How long a transparent window waits for its page's first frame before it turns opaque anyway.
const PAINT_WAIT: std::time::Duration = std::time::Duration::from_millis(600);

/// Puts the window on screen, transparent, so WebKit draws the launch view into it.
/// `public/launch.js` calls it as soon as the document's stylesheets have loaded, and
/// `window_painted` once a frame has landed.
#[tauri::command]
pub fn window_ready(window: WebviewWindow) {
    let window = window.as_ref().window();
    if window.is_visible().unwrap_or(false) {
        return;
    }
    set_opacity(&window, 0.0);
    if window.show().is_ok() {
        let _ = window.set_focus();
    }
    // A page whose frame never reports still turns opaque.
    std::thread::spawn(move || {
        std::thread::sleep(PAINT_WAIT);
        reveal(&window);
    });
}

/// Turns the window opaque: its page has painted a frame (`public/launch.js`).
#[tauri::command]
pub fn window_painted(window: WebviewWindow) {
    reveal(&window.as_ref().window());
}

/// Shows the window when its page has finished loading, in case the page never asked.
pub fn on_page_load<R: Runtime>(webview: &Webview<R>, payload: &PageLoadPayload<'_>) {
    if payload.event() != PageLoadEvent::Finished {
        return;
    }
    let window = webview.window();
    if !window.is_visible().unwrap_or(false) && window.show().is_ok() {
        let _ = window.set_focus();
    }
    reveal(&window);
}

/// Makes the window opaque; an opaque window stays as it is.
fn reveal<R: Runtime>(window: &Window<R>) {
    set_opacity(window, 1.0);
}

/// Sets the native window's opacity on the main thread, where AppKit requires it. The window is
/// found among the application's windows by its pointer, so no raw pointer is dereferenced.
#[cfg(target_os = "macos")]
fn set_opacity<R: Runtime>(window: &Window<R>, alpha: f64) {
    let target = window.clone();
    let _ = window.run_on_main_thread(move || {
        let (Some(main_thread), Ok(pointer)) = (objc2::MainThreadMarker::new(), target.ns_window())
        else {
            return;
        };
        let application = objc2_app_kit::NSApplication::sharedApplication(main_thread);
        for ns_window in application.windows().iter() {
            if objc2::rc::Retained::as_ptr(&ns_window).cast::<std::ffi::c_void>()
                == pointer.cast_const()
            {
                ns_window.setAlphaValue(alpha);
            }
        }
    });
}

/// Elsewhere the window shows as WebKit draws it, so it stays opaque.
#[cfg(not(target_os = "macos"))]
fn set_opacity<R: Runtime>(_window: &Window<R>, _alpha: f64) {}

/// The appearance a development build was asked to open in, `LERVO_ADE_APPEARANCE=light` or
/// `dark`, so the window can be checked in both without changing the system's appearance (ADE
/// craft rules, 17). Only this window changes, with its native material, as the system's own
/// setting would change it. Release builds ignore it.
#[cfg(debug_assertions)]
pub fn apply_development_appearance<R: Runtime>(app: &tauri::App<R>) {
    use tauri::Manager;
    let theme = match std::env::var("LERVO_ADE_APPEARANCE").as_deref() {
        Ok("light") => tauri::Theme::Light,
        Ok("dark") => tauri::Theme::Dark,
        _ => return,
    };
    for window in app.webview_windows().values() {
        let _ = window.set_theme(Some(theme));
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
