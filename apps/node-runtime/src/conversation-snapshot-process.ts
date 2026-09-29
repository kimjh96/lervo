import { fork } from "node:child_process";

import {
  RepositorySnapshotError,
  type CaptureRepositorySnapshot,
  type RepositorySnapshot,
  type RepositorySnapshotPolicy,
} from "@lervo/orchestrator";

const safeFailureMessages = new Set([
  "The repository snapshot policy is invalid.",
  "The repository snapshot root is not a safe real directory.",
  "Could not read the repository snapshot.",
  "The repository snapshot file-count limit was exceeded.",
  "Could not snapshot the repository file safely.",
  "The repository snapshot byte limit was exceeded.",
  "The Git coordinate changed during snapshot capture.",
]);

/** Captures managed conversation evidence outside the busy Node event loop. */
export function createConversationSnapshotProcessCapture(entry: string): CaptureRepositorySnapshot {
  return (repositoryRoot, policy) =>
    new Promise<RepositorySnapshot>((resolve, reject) => {
      let child;
      try {
        child = fork(
          entry,
          ["conversation-snapshot", "--root", repositoryRoot, "--owner", String(process.pid)],
          {
            execPath: process.execPath,
            execArgv: [],
            stdio: ["ignore", "ignore", "inherit", "ipc"],
          },
        );
      } catch {
        reject(new RepositorySnapshotError("Could not start the repository snapshot worker."));
        return;
      }
      let settled = false;
      const fail = (message = "Could not complete the repository snapshot worker.") => {
        if (settled) return;
        settled = true;
        reject(new RepositorySnapshotError(message));
      };
      child.once("error", () => fail());
      child.once("close", () => fail());
      child.on("message", (value: unknown) => {
        if (settled || typeof value !== "object" || value === null || !("type" in value)) return;
        if (value.type === "snapshot_error") {
          fail(
            "message" in value && safeFailureMessages.has(String(value.message))
              ? String(value.message)
              : "Could not complete the repository snapshot worker.",
          );
          return;
        }
        if (value.type !== "snapshot_result" || !("snapshot" in value)) return;
        const snapshot = value.snapshot as RepositorySnapshot;
        if (
          typeof snapshot?.revision !== "string" ||
          typeof snapshot.files !== "object" ||
          snapshot.files === null
        ) {
          fail();
          return;
        }
        settled = true;
        resolve(snapshot);
      });
      child.send(
        { type: "snapshot_request", policy: policy as RepositorySnapshotPolicy | undefined },
        (error) => {
          if (error !== null) fail();
        },
      );
    });
}
