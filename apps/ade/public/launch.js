// Asks the shell to show the window (src-tauri/src/window.rs). The shell creates it hidden, so it
// never opens empty while the webview starts. A classic script runs only after the stylesheets
// before it have loaded, so the launch view can paint by now. Outside the shell it does nothing.
globalThis.__TAURI_INTERNALS__?.invoke("window_ready");
