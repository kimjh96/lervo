export * from "./bootstrap.js";
export * from "./coordination-home.js";
export * from "./coordination-records.js";
export * from "./layout.js";
export * from "./repository-source-gate.js";
export * from "./types.js";

export { watchProjectEventChanges, type ProjectEventWatchOptions } from "./event-wakeup.js";
/** ADR-0602: the visible state of the event-store wake channel, for health and attention. */
export {
  holdProcessPresence,
  inspectEventStoreChannel,
  localProcessAlive,
  localProcessIdentity,
  probeProcessPresence,
  processPresenceDirectory,
  wakeProcessPresence,
  waitForProcessExit,
  type HeldProcessPresence,
  type ProcessPresenceProbe,
  type EventStoreChannelIssue,
  type LocalProcessIdentity,
} from "@lervo/event-store-sqlite";
export {
  watchChangeToken,
  type ChangeTokenChannel,
  type ChangeTokenWatchHealth,
  type ChangeTokenWatchOptions,
} from "./change-token-watch.js";

export { createProjectStoragePool } from "./storage-pool.js";
