import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { SessionHostClient, tauriTransport } from "./platform/session-host";
import "./app/global.css";

const container = document.getElementById("root");
if (container === null) throw new Error("index.html has no #root element.");

// macOS draws the native window material behind the webview; other platforms use opaque tokens.
document.documentElement.dataset.material = navigator.userAgent.includes("Mac OS")
  ? "native"
  : "opaque";

const client = new SessionHostClient(await tauriTransport());

createRoot(container).render(
  <StrictMode>
    <App client={client} />
  </StrictMode>,
);
