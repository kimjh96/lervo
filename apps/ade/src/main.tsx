import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { restoreWorkspaces } from "./features/workspaces";
import { webClipboard } from "./platform/clipboard";
import { bindFirstClick } from "./platform/first-click";
import { canvasImages } from "./platform/images";
import { tauriNotifier } from "./platform/notifications";
import { SessionHostClient, SessionHostCommands, tauriTransport } from "./platform/session-host";
import { localDrafts, localLists } from "./platform/storage";
import { bindVisibility } from "./platform/visibility";
// `index.html` links the document's styles (`ui/base.css`, `app/global.css`, `app/launch.css`),
// so they apply before this script runs.
import "./ui/motion.css";

// The composition root: it builds each adapter once and hands them to the application. Nothing
// here waits, so the session host connection starts as soon as the script runs (ADE performance,
// cold start); `lervo:` marks time each step for the interface harness.

performance.mark("lervo:main");

const container = document.getElementById("root");
if (container === null) throw new Error("index.html has no #root element.");

bindVisibility();
bindFirstClick();

const notifier = tauriNotifier();
const host = new SessionHostClient(tauriTransport());
const adapters = {
  host,
  replacement: host,
  commands: new SessionHostCommands(host),
  drafts: localDrafts(),
  lists: localLists(),
  clipboard: webClipboard(),
  images: canvasImages(),
};
host.start();
// The lists kept from the last launch show at once; the core's answer replaces them.
restoreWorkspaces(adapters.lists);

createRoot(container).render(
  <StrictMode>
    <App adapters={adapters} notifier={notifier} />
  </StrictMode>,
);

// The interface harness, only when the shell was started to measure (ADE performance).
const measurement = (globalThis as { __LERVO_MEASURE__?: { scenario: string } }).__LERVO_MEASURE__;
if (measurement !== undefined)
  void import("./platform/measure").then(({ runMeasurement }) =>
    runMeasurement(measurement.scenario, host),
  );
