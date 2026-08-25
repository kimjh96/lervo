import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { resolveProjectPaths } from "./layout.js";
import { planStatePrune } from "./state-retention-plan.js";
import type {
  StatePrunePlan,
  StatePruneReceipt,
  StateRetentionEvidence,
  StateRetentionPolicy,
} from "./state-retention-types.js";

interface Journal {
  planId: string;
  moves: Array<{ source: string; target: string }>;
}

function tombstonePath(repositoryRoot: string, planId: string): string {
  return resolve(repositoryRoot, `.lervo/.state-prune-${planId}`);
}

async function rollback(journal: Journal): Promise<void> {
  for (const move of journal.moves.toReversed()) {
    await mkdir(dirname(move.source), { recursive: true });
    await rename(move.target, move.source);
  }
}

export async function applyStatePrune(input: {
  plan: StatePrunePlan;
  approval: string;
  evidence: StateRetentionEvidence;
  policy?: StateRetentionPolicy;
  recordEvent: (receipt: StatePruneReceipt) => void | Promise<void>;
  now?: Date;
}): Promise<StatePruneReceipt> {
  if (input.approval !== input.plan.planId)
    throw new Error("Approval must equal the current state prune plan ID.");
  if (input.plan.status === "blocked") throw new Error("The state prune plan is blocked.");
  const current = await planStatePrune({
    repositoryRoot: input.plan.repositoryRoot,
    evidence: input.evidence,
    ...(input.policy === undefined ? {} : { policy: input.policy }),
    now: new Date(input.plan.inspectedAt),
  });
  if (current.planId !== input.plan.planId)
    throw new Error("Derived state changed after planning; create a new prune plan.");

  const stateRoot = resolveProjectPaths(input.plan.repositoryRoot).state;
  const tombstone = tombstonePath(input.plan.repositoryRoot, input.plan.planId);
  const journal: Journal = { planId: input.plan.planId, moves: [] };
  await mkdir(tombstone, { recursive: false });
  try {
    for (const operation of input.plan.operations) {
      const source = resolve(stateRoot, operation.relativePath);
      const target = resolve(tombstone, "content", operation.relativePath);
      await mkdir(dirname(target), { recursive: true });
      await rename(source, target);
      journal.moves.push({ source, target });
      await writeFile(resolve(tombstone, "journal.json"), `${JSON.stringify(journal, null, 2)}\n`, {
        flag: "w",
      });
    }
    const removedByClass: StatePruneReceipt["removedByClass"] = {};
    for (const item of input.plan.operations) {
      const value = (removedByClass[item.retentionClass] ??= { artifacts: 0, files: 0, bytes: 0 });
      value.artifacts += 1;
      value.files += item.fileCount;
      value.bytes += item.byteCount;
    }
    const receipt: StatePruneReceipt = {
      schemaVersion: 1,
      receiptKind: "derived_state_prune_applied",
      planId: input.plan.planId,
      policyHash: input.plan.policyHash,
      inventoryDigest: input.plan.inventoryDigest,
      removedFiles: input.plan.operations.reduce((sum, item) => sum + item.fileCount, 0),
      removedBytes: input.plan.operations.reduce((sum, item) => sum + item.byteCount, 0),
      removedByClass,
      appliedAt: (input.now ?? new Date()).toISOString(),
      durableDataDisposition: "preserved",
    };
    await input.recordEvent(receipt);
    await rm(tombstone, { recursive: true });
    return receipt;
  } catch (error) {
    await rollback(journal);
    await rm(tombstone, { recursive: true });
    throw error;
  }
}

export async function recoverInterruptedStatePrune(input: {
  repositoryRoot: string;
  planId: string;
  eventExists: boolean;
}): Promise<"cleaned" | "rolled_back"> {
  const tombstone = tombstonePath(resolve(input.repositoryRoot), input.planId);
  if (input.eventExists) {
    await rm(tombstone, { recursive: true });
    return "cleaned";
  }
  const journal = JSON.parse(await readFile(resolve(tombstone, "journal.json"), "utf8")) as Journal;
  if (journal.planId !== input.planId) throw new Error("State prune recovery journal mismatch.");
  await rollback(journal);
  await rm(tombstone, { recursive: true });
  return "rolled_back";
}
