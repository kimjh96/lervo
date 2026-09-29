import { isAbsolute } from "node:path";

import {
  captureRepositorySnapshot,
  RepositorySnapshotError,
  type RepositorySnapshotPolicy,
} from "@lervo/orchestrator";

/** Internal one-shot, read-only child route; its parent owns the IPC channel. */
export async function runConversationSnapshotCli(args: readonly string[]): Promise<number> {
  const [rootFlag, root, ownerFlag, owner] = args;
  if (
    args.length !== 4 ||
    rootFlag !== "--root" ||
    root === undefined ||
    !isAbsolute(root) ||
    ownerFlag !== "--owner" ||
    owner !== String(process.ppid) ||
    !process.connected
  ) {
    process.stderr.write("Lervo conversation snapshot requires its owning Node IPC channel.\n");
    return 1;
  }
  return new Promise<number>((resolve) => {
    let requested = false;
    let finished = false;
    const finish = (code: number) => {
      finished = true;
      if (process.connected) process.disconnect();
      resolve(code);
    };
    process.once("disconnect", () => {
      if (!finished) process.exit(1);
    });
    process.on("message", (value: unknown) => {
      if (
        requested ||
        typeof value !== "object" ||
        value === null ||
        !("type" in value) ||
        value.type !== "snapshot_request"
      )
        return;
      requested = true;
      const policy =
        "policy" in value ? (value.policy as RepositorySnapshotPolicy | undefined) : undefined;
      void captureRepositorySnapshot(root, policy)
        .then((snapshot) => {
          process.send?.({ type: "snapshot_result", snapshot }, (error) => {
            finish(error === null ? 0 : 1);
          });
        })
        .catch((error: unknown) => {
          process.send?.(
            {
              type: "snapshot_error",
              message:
                error instanceof RepositorySnapshotError
                  ? error.message
                  : "Could not snapshot the repository file safely.",
            },
            () => finish(1),
          );
        });
    });
  });
}
