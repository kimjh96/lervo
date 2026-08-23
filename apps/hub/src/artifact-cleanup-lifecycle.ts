import { type Server } from "node:http";
import { type Server as SecureServer } from "node:https";

import {
  HubCommandError,
  runHubCommandArtifactCleanupLoop,
  type HubCommandArtifactCleanupLoopOptions,
  type HubCommandArtifactCleanupLoopResult,
} from "@lervo/hub-command";

export type HubLifecycleServer = Server | SecureServer;

const attachedServers = new WeakSet<HubLifecycleServer>();

export type HubArtifactCleanupLifecycleResult =
  | { status: "stopped"; loop: HubCommandArtifactCleanupLoopResult | null }
  | { status: "failed"; failureCode: "artifact_cleanup_runtime_failed" };

export interface HubArtifactCleanupLifecycle {
  readonly settled: Promise<HubArtifactCleanupLifecycleResult>;
  stop(): Promise<HubArtifactCleanupLifecycleResult>;
}

/** Binds cleanup start/stop to an HTTP server without making the server own storage. */
export function attachHubArtifactCleanupLifecycle(input: {
  server: HubLifecycleServer;
  runtime: Omit<HubCommandArtifactCleanupLoopOptions, "signal">;
  onFailure?: (failureCode: "artifact_cleanup_runtime_failed") => void | Promise<void>;
}): HubArtifactCleanupLifecycle {
  if (attachedServers.has(input.server)) {
    throw new HubCommandError("invalid_request", "A cleanup lifecycle can be attached to a Hub server only once.");
  }
  attachedServers.add(input.server);
  const controller = new AbortController();
  let started = false;
  let settled = false;
  let resolveSettled!: (result: HubArtifactCleanupLifecycleResult) => void;
  const settledPromise = new Promise<HubArtifactCleanupLifecycleResult>((resolve) => {
    resolveSettled = resolve;
  });

  function finish(result: HubArtifactCleanupLifecycleResult): void {
    if (settled) return;
    settled = true;
    resolveSettled(result);
  }

  function start(): void {
    if (started || settled) return;
    started = true;
    void runHubCommandArtifactCleanupLoop({ ...input.runtime, signal: controller.signal })
      .then((loop) => finish({ status: "stopped", loop }))
      .catch(async () => {
        try {
          await input.onFailure?.("artifact_cleanup_runtime_failed");
        } finally {
          finish({ status: "failed", failureCode: "artifact_cleanup_runtime_failed" });
        }
      });
  }

  function requestStop(): void {
    controller.abort();
    if (!started) finish({ status: "stopped", loop: null });
  }

  input.server.once("listening", start);
  input.server.once("close", requestStop);
  if (input.server.listening) queueMicrotask(start);

  return {
    settled: settledPromise,
    async stop() {
      requestStop();
      return settledPromise;
    },
  };
}
