import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { tauriNotifier } from "./platform/notifications";
import { SessionHostClient, tauriTransport } from "./platform/session-host";
import "./app/global.css";

const container = document.getElementById("root");
if (container === null) throw new Error("index.html has no #root element.");

// macOS draws the native window material behind the webview; other platforms use opaque tokens.
document.documentElement.dataset.material = navigator.userAgent.includes("Mac OS")
  ? "native"
  : "opaque";

const [transport, notifier] = await Promise.all([tauriTransport(), tauriNotifier()]);
const client = new SessionHostClient(transport);

createRoot(container).render(
  <StrictMode>
    <App client={client} notifier={notifier} />
  </StrictMode>,
);
