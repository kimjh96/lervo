//! Tells the interface which window material the shell draws, before the page's first paint, so
//! the launch view and the first screen sit on the right surface from their first frame.

use tauri::Runtime;
use tauri::plugin::{Builder, TauriPlugin};

/// The material on macOS, where `tauri.macos.conf.json` draws the native window effect behind a
/// transparent webview. Other platforms draw an opaque window.
#[cfg(target_os = "macos")]
const MATERIAL: &str = "native";
#[cfg(not(target_os = "macos"))]
const MATERIAL: &str = "opaque";

/// A plugin whose initialization script sets `data-material` on the document element, which
/// `src/app/global.css` reads. The script runs before any page content loads.
pub fn plugin<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("material")
        .js_init_script(format!(
            "document.documentElement.dataset.material = \"{MATERIAL}\";"
        ))
        .build()
}
