import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { nodeRuntimesDirectory } from "./node-runtime-pointer.js";
import { managedRuntimeInventory } from "./node-runtime-retention-inventory.js";
import { withNodeRuntimeRetentionLock } from "./node-runtime-retention-lock.js";
import { rollbackPins, storeRuntimeRollbackPins } from "./node-runtime-rollback-pins.js";

/** Signed rollout rollback binds enrollment bytes, which can predate the installed service. */
export async function pinEnrolledRuntimePredecessor(input: {
  enrollmentId: string;
  artifactHash: string;
  homeDirectory?: string;
  platform?: NodeJS.Platform;
}): Promise<void> {
  const root = nodeRuntimesDirectory(input.homeDirectory, input.platform);
  const exists = await lstat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (exists === null) return;
  await withNodeRuntimeRetentionLock(resolve(root, ".retention.lock"), async () => {
    const inventory = await managedRuntimeInventory(input.homeDirectory, input.platform);
    const matched: string[] = [];
    for (const runtime of inventory) {
      const launcher = await readFile(
        resolve(root, runtime.name, `lervo-node-launcher-${runtime.name.slice(0, 12)}`),
      );
      if (`sha256:${createHash("sha256").update(launcher).digest("hex")}` === input.artifactHash)
        matched.push(runtime.name);
    }
    // Unknown historical enrollment bytes cannot grant deletion authority over existing runtimes.
    const names = matched.length ? matched : inventory.map((runtime) => runtime.name);
    if (!names.length) return;
    await storeRuntimeRollbackPins(
      {
        servicePath: `enrollment:${input.enrollmentId}`,
        ...(input.platform === undefined ? {} : { platform: input.platform }),
        ...(input.homeDirectory === undefined ? {} : { homeDirectory: input.homeDirectory }),
      },
      await rollbackPins(input.homeDirectory, input.platform),
      names,
    );
  });
}
