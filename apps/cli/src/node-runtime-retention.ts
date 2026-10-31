import type { ProcessObservation } from "@lervo/node-runtime";
import { assertRealRuntimeRoot } from "./node-runtime-root-guard.js";
import {
  recoverRuntimeRetirement,
  journalRuntimeRetirement,
  hasRuntimeRetirementJournal,
} from "./node-runtime-retirement-journal.js";
import { randomUUID } from "node:crypto";
import { lstat, rename } from "node:fs/promises";
import { resolve } from "node:path";

import {
  managedRuntimeInventory,
  type RetainedRuntimeDirectory,
} from "./node-runtime-retention-inventory.js";
import { protectedRuntimeReferences } from "./node-runtime-retention-references.js";
import { withNodeRuntimeRetentionLock } from "./node-runtime-retention-lock.js";
import { nodeRuntimesDirectory, readCurrentNodeRuntime } from "./node-runtime-pointer.js";

export interface RuntimeRetentionPlan {
  disposition: "current" | "safe_apply" | "deferred";
  reason:
    "runtime_retention_current" | "runtime_retention_ready" | "runtime_references_unavailable";
  candidates: RetainedRuntimeDirectory[];
  reclaimableBytes: number;
  keepNewest: 2;
}

export interface RuntimeRetentionOptions {
  homeDirectory?: string;
  platform?: NodeJS.Platform;
  processCommands?: () => Promise<string>;
  observeProcess?: (pid: number) => ProcessObservation;
}

/** Pure retention policy: recency is additional to every independently protected consumer. */
export function runtimeRetirementCandidates(
  inventory: RetainedRuntimeDirectory[],
  protectedNames: ReadonlySet<string>,
): RetainedRuntimeDirectory[] {
  const others = inventory
    .filter((item) => !protectedNames.has(item.name))
    .sort(
      (left, right) => right.modifiedAt - left.modifiedAt || right.name.localeCompare(left.name),
    );
  return others.slice(2);
}

export async function planNodeRuntimeRetention(
  input: RuntimeRetentionOptions = {},
): Promise<RuntimeRetentionPlan> {
  try {
    const inventory = await managedRuntimeInventory(input.homeDirectory, input.platform);
    if (!inventory.length)
      return {
        disposition: "current",
        reason: "runtime_retention_current",
        candidates: [],
        reclaimableBytes: 0,
        keepNewest: 2,
      };
    const current = await readCurrentNodeRuntime(input.homeDirectory, input.platform);
    if (current === null || !inventory.some((item) => item.name === current))
      throw new Error("Runtime pointer is unavailable.");
    const protectedNames = await protectedRuntimeReferences(input);
    protectedNames.add(current);
    const candidates = runtimeRetirementCandidates(inventory, protectedNames);
    return {
      disposition: candidates.length ? "safe_apply" : "current",
      reason: candidates.length ? "runtime_retention_ready" : "runtime_retention_current",
      candidates,
      reclaimableBytes: candidates.reduce((sum, item) => sum + item.bytes, 0),
      keepNewest: 2,
    };
  } catch {
    return {
      disposition: "deferred",
      reason: "runtime_references_unavailable",
      candidates: [],
      reclaimableBytes: 0,
      keepNewest: 2,
    };
  }
}

/** Reobserve consumers under the writer lock; only the approved intersection can be detached. */
export async function applyNodeRuntimeRetention(
  approved: RuntimeRetentionPlan,
  input: RuntimeRetentionOptions = {},
): Promise<number> {
  const root = nodeRuntimesDirectory(input.homeDirectory, input.platform);
  if (approved.disposition !== "safe_apply" && !(await hasRuntimeRetirementJournal(root))) return 0;
  return withNodeRuntimeRetentionLock(resolve(root, ".retention.lock"), async () => {
    await recoverRuntimeRetirement(root);
    const current = await planNodeRuntimeRetention(input);
    let removed = 0;
    for (const item of approved.candidates) {
      if (
        !current.candidates.some(
          (candidate) => candidate.name === item.name && candidate.identity === item.identity,
        )
      )
        continue;
      // Consumers can start after planning. Check again immediately before the detach.
      const references = await protectedRuntimeReferences(input);
      if (
        references.has(item.name) ||
        (await readCurrentNodeRuntime(input.homeDirectory, input.platform)) === item.name
      )
        continue;
      await assertRealRuntimeRoot(root, input.platform);
      const path = resolve(root, item.name);
      const info = await lstat(path);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        !item.identity.startsWith(`${info.dev}:${info.ino}:${info.mtimeMs}:`)
      )
        continue;
      const retired = `.retired-${item.name}-${randomUUID()}`;
      await journalRuntimeRetirement(root, item.name, retired);
      await rename(path, resolve(root, retired));
      // rm never follows a symbolic link. An interrupted detach leaves only an unreferenced tree.
      await recoverRuntimeRetirement(root);
      removed++;
    }
    return removed;
  });
}

export async function maintainNodeRuntimeRetention(
  input: RuntimeRetentionOptions = {},
): Promise<void> {
  await applyNodeRuntimeRetention(await planNodeRuntimeRetention(input), input).catch(
    () => undefined,
  );
}
