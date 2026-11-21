import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { defaultRepositoryHoldPath } from "@lervo/repository-registry";

import { CONVERGENCE_OWNER_FENCE_PATH } from "./convergence-owner-fence.js";
import { repositoryWatchReporter } from "./repository-watch-state.js";
import { watchFiles } from "./resident-file-watch.js";
import { residentProjectionInputPaths } from "./resident-projection-fence.js";

/**
 * ADR-0602: the files a resident reacts to besides events and repository edits: the health
 * projection's inputs, the host hold store, and this checkout's owner fence, which a release
 * command in another process rewrites. A watch that cannot be armed is visible as
 * `repository_watch_unavailable`; the hold store's directory is created so its first hold is
 * always seen.
 */
export function watchResidentInputs(input: {
  repositoryRoot: string;
  projection: boolean;
  onProjectionInput: () => void;
  onHoldStore: () => void;
  onOwnerFence?: () => void;
}): { stop(): Promise<void> } {
  const report = repositoryWatchReporter(input.repositoryRoot);
  const failed = (error: unknown) => void report.failed(error);
  const projection = input.projection
    ? watchFiles(
        residentProjectionInputPaths(input.repositoryRoot),
        input.onProjectionInput,
        failed,
      )
    : null;
  const holdPath = defaultRepositoryHoldPath();
  try {
    mkdirSync(dirname(holdPath), { recursive: true, mode: 0o700 });
  } catch (error) {
    failed(error);
  }
  const hold = watchFiles([holdPath], input.onHoldStore, failed);
  const fence =
    input.onOwnerFence === undefined
      ? null
      : watchFiles(
          [resolve(input.repositoryRoot, CONVERGENCE_OWNER_FENCE_PATH)],
          input.onOwnerFence,
          failed,
        );
  return {
    stop: async () => {
      projection?.stop();
      hold.stop();
      fence?.stop();
      await report.armed();
    },
  };
}
