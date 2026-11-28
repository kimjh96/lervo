// Asks the shell to put the window on screen (src-tauri/src/window.rs). The shell creates it hidden,
// so it never opens empty while the webview starts. A classic script runs only after the
// stylesheets before it have loaded, so the launch view can paint by now. The window goes on
// screen transparent, because WebKit draws nothing for a window that is off screen, and turns
// opaque once a frame has landed: the second animation frame after it shows. Outside the shell it
// does nothing.
const shell = globalThis.__TAURI_INTERNALS__;
if (shell !== undefined)
  void shell
    .invoke("window_ready")
    .then(() =>
      globalThis.requestAnimationFrame(() =>
        globalThis.requestAnimationFrame(() => void shell.invoke("window_painted")),
      ),
    );
