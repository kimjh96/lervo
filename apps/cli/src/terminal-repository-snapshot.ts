import { resolve } from "node:path";
import { capturePersistentRepositorySnapshot, type RepositorySnapshot } from "@lervo/orchestrator";

/** Terminal hooks reuse private stat-identity hashes so a prompt or Stop never rehashes everything. */
export function captureTerminalRepositorySnapshot(root: string): Promise<RepositorySnapshot> {
  return capturePersistentRepositorySnapshot(
    root,
    resolve(root, ".lervo/state/cache/terminal-repository-snapshot.json"),
  );
}
