import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import {
  applyStatePrune,
  planStatePrune,
  publicStatePrunePlan,
  recoverInterruptedStatePrune,
  resolveProjectPaths,
  type StatePruneReceipt,
} from "@lervo/project";
import { openProjectStorage } from "@lervo/project-storage";
import { assertNoKnowledgeMaterializationTransaction } from "@lervo/repository-knowledge";
import { visitEventSnapshot } from "@lervo/storage-contract";

import { effectBackupUndoCommand, restoreEffectBackup, takeEffectBackup } from "./effect-backup.js";
import { foregroundKnowledgeMaterializationSettlement } from "./knowledge-materialization-wait.js";
import { hasRemovedOption, REMOVED_APPLY_APPROVAL } from "./removed-approval-options.js";
import { inspectStateRetentionEvidence } from "./state-retention-evidence.js";
import { runStateCasRetentionCommand } from "./state-cas-retention-command.js";
import { planStateReset, type StatePlan } from "./state-reset-plan.js";
import type { CliIo, CliServices } from "./types.js";

export const stateUsage =
  "  lervo state status [--root <path>] [--json]\n  lervo state prune [--apply | --recover <plan-id>] [--root <path>] [--json]\n  lervo state reset [--apply] [--root <path>] [--json]\n  lervo state restore <backup-id> [--root <path>] [--json]\n  lervo state cas-retention --plan [--root <path>] [--json]";

interface StateStatus {
  schemaVersion: 1;
  inspectionKind: "derived_state_status";
  repositoryRoot: string;
  stateDisposition: "present" | "empty";
  fileCount: number;
  totalBytes: number;
  durableDataPath: ".lervo/data";
  durableDataDisposition: "preserved";
  resetPlanDisposition: "run_state_reset_to_create_content_bound_plan";
  retention: {
    policyMode: "manual_plan_apply";
    unattendedCleanup: "disabled" | "eligible";
    pruneStatus: "ready" | "current" | "blocked";
    protectedFiles: number;
    protectedBytes: number;
    reclaimableFiles: number;
    reclaimableBytes: number;
    blockers: readonly string[];
  };
}

function statusFromPlan(current: StatePlan, retention: StateStatus["retention"]): StateStatus {
  return {
    schemaVersion: 1,
    inspectionKind: "derived_state_status",
    repositoryRoot: current.repositoryRoot,
    stateDisposition: current.status === "ready" ? "present" : "empty",
    fileCount: current.fileCount,
    totalBytes: current.totalBytes,
    durableDataPath: current.durableDataPath,
    durableDataDisposition: current.durableDataDisposition,
    resetPlanDisposition: "run_state_reset_to_create_content_bound_plan",
    retention,
  };
}

async function existingPruneTombstones(repositoryRoot: string): Promise<string[]> {
  try {
    return (await readdir(resolve(repositoryRoot, ".lervo")))
      .filter((name) => name.startsWith(".state-prune-kstateprune_"))
      .map((name) => name.slice(".state-prune-".length))
      .toSorted();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function retentionBlockers(repositoryRoot: string): Promise<string[]> {
  const blockers = (await existingPruneTombstones(repositoryRoot)).map(
    (id) => `interrupted_prune:${id}`,
  );
  try {
    await assertNoKnowledgeMaterializationTransaction({ repositoryRoot });
  } catch {
    blockers.push("knowledge_materialization_recovery_required");
  }
  return blockers;
}

async function nodeRuntimeEligible(repositoryRoot: string): Promise<boolean> {
  try {
    const value = JSON.parse(
      await readFile(resolve(repositoryRoot, ".lervo/state/node-runtime-health.json"), "utf8"),
    ) as { status?: unknown };
    return value.status === "ready";
  } catch {
    return false;
  }
}

function statePruneEventExists(
  storage: Awaited<ReturnType<typeof openProjectStorage>>,
  planId: string,
): boolean {
  let found = false;
  const latest = storage.events.latest();
  if (latest === null) return false;
  visitEventSnapshot({
    events: storage.events,
    throughSeq: latest.seq,
    visit: (event) => {
      if (event.type === "state.pruned" && event.payload.planId === planId) found = true;
    },
  });
  return found;
}

function appendStatePrunedEvent(
  storage: Awaited<ReturnType<typeof openProjectStorage>>,
  receipt: StatePruneReceipt,
): void {
  const identity = randomUUID().replaceAll("-", "");
  storage.events.append({
    eventId: `evt_${identity}`,
    projectId: storage.manifest.projectId,
    runId: `run_${identity}`,
    sessionId: `ses_${identity}`,
    type: "state.pruned",
    occurredAt: receipt.appliedAt,
    actor: { kind: "system" },
    schemaVersion: 1,
    policyVersion: receipt.policyHash,
    payload: {
      planId: receipt.planId,
      policyHash: receipt.policyHash,
      inventoryDigest: receipt.inventoryDigest,
      removedFiles: receipt.removedFiles,
      removedBytes: receipt.removedBytes,
      classCounts: Object.entries(receipt.removedByClass).map(([retentionClass, counts]) => ({
        retentionClass,
        ...counts,
      })),
      appliedAt: receipt.appliedAt,
    },
  });
}

async function runPrune(input: {
  repositoryRoot: string;
  apply: boolean;
  recover?: string;
  json: boolean;
  io: CliIo;
}): Promise<number> {
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    if (input.recover !== undefined) {
      const disposition = await recoverInterruptedStatePrune({
        repositoryRoot: input.repositoryRoot,
        planId: input.recover,
        eventExists: statePruneEventExists(storage, input.recover),
      });
      input.io.stdout(
        input.json
          ? `${JSON.stringify({ planId: input.recover, disposition }, null, 2)}\n`
          : `Recovered state prune ${input.recover}: ${disposition}.\n`,
      );
      return 0;
    }
    const evidence = await inspectStateRetentionEvidence({
      repositoryRoot: input.repositoryRoot,
      storage,
    });
    const current = await planStatePrune({
      repositoryRoot: input.repositoryRoot,
      evidence,
      blockers: await retentionBlockers(input.repositoryRoot),
    });
    if (!input.apply) {
      const output = publicStatePrunePlan(current);
      input.io.stdout(
        input.json
          ? `${JSON.stringify(output, null, 2)}\n`
          : `State prune: ${current.status}; ${current.operations.reduce((sum, item) => sum + item.fileCount, 0)} files and ${current.operations.reduce((sum, item) => sum + item.byteCount, 0)} bytes reclaimable.${current.status === "ready" ? " Re-run with --apply." : ""}\n`,
      );
      return current.status === "blocked" ? 1 : 0;
    }
    // ADR-0561: prune removes only rebuildable derived artifacts its retention policy classified,
    // so the canonical sources are their backup. The plan is bound internally: apply plans again
    // and refuses a derived state that changed in between.
    const receipt = await applyStatePrune({
      plan: current,
      approval: current.planId,
      evidence,
      recordEvent: (value) => appendStatePrunedEvent(storage, value),
    });
    input.io.stdout(
      input.json
        ? `${JSON.stringify(receipt, null, 2)}\n`
        : `Pruned ${receipt.removedFiles} derived-state files (${receipt.removedBytes} bytes). Durable .lervo/data was preserved.\n`,
    );
    return 0;
  } finally {
    await storage.close();
  }
}

export async function runStateCommand(
  args: string[],
  io: CliIo,
  services: Pick<CliServices, "knowledgeMaterializationWait"> = {},
): Promise<number> {
  // Read-only; it must not wait on materialization or open a writable store.
  if (args[0] === "cas-retention") return runStateCasRetentionCommand(args.slice(1), io);
  try {
    if (hasRemovedOption(args, "approval")) throw new Error(REMOVED_APPLY_APPROVAL);
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        json: { type: "boolean" },
        apply: { type: "boolean" },
        recover: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (parsed.values.help) {
      io.stdout(`${stateUsage}\n`);
      return 0;
    }
    const action = parsed.positionals[0];
    if (
      action === undefined ||
      !["status", "prune", "reset", "restore"].includes(action) ||
      parsed.positionals.length !== (action === "restore" ? 2 : 1)
    )
      throw new Error("Specify state status, prune, reset, or restore <backup-id>.");
    const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
    if (action === "restore") {
      const restored = await restoreEffectBackup({
        repositoryRoot,
        backupId: parsed.positionals[1]!,
      });
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify({ schemaVersion: 1, operation: "effect_backup_restored", ...restored }, null, 2)}\n`
          : `Restored backup ${restored.backupId} (${restored.effect}): ${restored.restoredPaths} path(s).\n`,
      );
      return 0;
    }
    // Retention and reset classify any remaining marker; a live owner settles first.
    await foregroundKnowledgeMaterializationSettlement({
      repositoryRoot,
      io,
      timing: services.knowledgeMaterializationWait,
    }).settle();
    if (action === "prune") {
      if (parsed.values.recover !== undefined && parsed.values.apply)
        throw new Error("--recover cannot be combined with --apply.");
      return await runPrune({
        repositoryRoot,
        apply: parsed.values.apply ?? false,
        ...(parsed.values.recover === undefined ? {} : { recover: parsed.values.recover }),
        json: parsed.values.json ?? false,
        io,
      });
    }
    const current = await planStateReset(repositoryRoot, action === "reset");
    if (action === "status") {
      const storage = await openProjectStorage(repositoryRoot);
      let evidence;
      try {
        evidence = await inspectStateRetentionEvidence({ repositoryRoot, storage });
      } finally {
        await storage.close();
      }
      const prune = await planStatePrune({
        repositoryRoot,
        evidence,
        blockers: await retentionBlockers(repositoryRoot),
      });
      const reclaimable = prune.summaries.reduce(
        (totals, item) => ({
          files: totals.files + item.reclaimableFileCount,
          bytes: totals.bytes + item.reclaimableBytes,
        }),
        { files: 0, bytes: 0 },
      );
      const status = statusFromPlan(current, {
        policyMode: "manual_plan_apply",
        unattendedCleanup: (await nodeRuntimeEligible(repositoryRoot)) ? "eligible" : "disabled",
        pruneStatus: prune.status,
        protectedFiles: current.fileCount - reclaimable.files,
        protectedBytes: current.totalBytes - reclaimable.bytes,
        reclaimableFiles: reclaimable.files,
        reclaimableBytes: reclaimable.bytes,
        blockers: prune.blockers,
      });
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(status, null, 2)}\n`
          : `Derived state: ${status.fileCount} files, ${status.totalBytes} bytes (${status.stateDisposition}). Durable .lervo/data is preserved. Run lervo state reset to create a content-bound reset plan.\n`,
      );
      return 0;
    }
    if (!parsed.values.apply) {
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(current, null, 2)}\n`
          : `Derived state: ${current.fileCount} files, ${current.totalBytes} bytes (${current.status}). Durable .lervo/data is preserved.\n${current.status === "ready" ? "Re-run with --apply; the removed state is kept as one backup until the next reset.\n" : ""}`,
      );
      return 0;
    }
    // ADR-0561: reset moves the derived state into one backup instead of deleting it, so
    // `lervo state restore` undoes it until the next reset replaces that backup.
    const backup =
      current.status === "ready"
        ? await takeEffectBackup({
            repositoryRoot: current.repositoryRoot,
            effect: "state_reset",
            reason: `Reset ${current.fileCount} derived-state files (plan ${current.planId}).`,
            movedDirectories: [resolveProjectPaths(current.repositoryRoot).state],
          })
        : null;
    const receipt = {
      ...(await planStateReset(current.repositoryRoot, false)),
      resetPlanId: current.planId,
      removedFiles: current.fileCount,
      removedBytes: current.totalBytes,
      backupId: backup?.backupId ?? null,
      undo: backup === null ? null : effectBackupUndoCommand(backup.backupId),
    };
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(receipt, null, 2)}\n`
        : `Reset derived state: ${current.fileCount} files, ${current.totalBytes} bytes. Durable .lervo/data was preserved.${receipt.undo === null ? "" : `\nUndo: ${receipt.undo}`}\n`,
    );
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${stateUsage}\n`);
    return 1;
  }
}
