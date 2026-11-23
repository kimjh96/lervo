import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { tauriNotifier } from "./platform/notifications";
import { SessionHostClient, SessionHostCommands, tauriTransport } from "./platform/session-host";
import { localDrafts } from "./platform/storage";
import { bindVisibility } from "./platform/visibility";
// `index.html` links the document's styles (`ui/base.css`, `app/global.css`, `app/launch.css`),
// so they apply before this script runs.
import "./ui/motion.css";

// The composition root: it builds each adapter once and hands them to the application.

const container = document.getElementById("root");
if (container === null) throw new Error("index.html has no #root element.");

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

// The interface harness, only when the shell was started to measure (ADE performance).
const measurement = (globalThis as { __LERVO_MEASURE__?: { scenario: string } }).__LERVO_MEASURE__;
if (measurement !== undefined)
  void import("./platform/measure").then(({ runMeasurement }) =>
    runMeasurement(measurement.scenario),
  );
