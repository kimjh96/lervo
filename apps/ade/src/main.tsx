import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { isMac } from "./platform/environment";
import { tauriNotifier } from "./platform/notifications";
import { SessionHostClient, SessionHostCommands, tauriTransport } from "./platform/session-host";
import { localDrafts } from "./platform/storage";
import { bindVisibility } from "./platform/visibility";
import "./ui/base.css";
import "./ui/motion.css";
import "./app/global.css";

// The composition root: it builds each adapter once and hands them to the application.

const container = document.getElementById("root");
if (container === null) throw new Error("index.html has no #root element.");

// macOS draws the native window material behind the webview; other platforms use opaque tokens.
document.documentElement.dataset.material = isMac ? "native" : "opaque";
bindVisibility();

const [transport, notifier] = await Promise.all([tauriTransport(), tauriNotifier()]);
const host = new SessionHostClient(transport);
const adapters = { host, commands: new SessionHostCommands(host), drafts: localDrafts() };
host.start();

createRoot(container).render(
  <StrictMode>
    <App adapters={adapters} notifier={notifier} />
  </StrictMode>,
);
