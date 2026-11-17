import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, rename, rm } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
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

import { foregroundKnowledgeMaterializationSettlement } from "./knowledge-materialization-wait.js";
import { inspectStateRetentionEvidence } from "./state-retention-evidence.js";
import { runStateCasRetentionCommand } from "./state-cas-retention-command.js";
import type { CliIo, CliServices } from "./types.js";

export const stateUsage =
  "  lervo state status [--root <path>] [--json]\n  lervo state prune [--apply --approval <plan-id> | --recover <plan-id>] [--root <path>] [--json]\n  lervo state reset [--apply --approval <plan-id>] [--root <path>] [--json]\n  lervo state cas-retention --plan [--root <path>] [--json]";

interface StatePlan {
  schemaVersion: 1;
  planKind: "derived_state_reset";
  planId: string;
  repositoryRoot: string;
  status: "ready" | "current";
  fileCount: number;
  totalBytes: number;
  contentDigest: string;
  durableDataPath: ".lervo/data";
  durableDataDisposition: "preserved";
}

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
  approval?: string;
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
          : `State prune: ${current.status}; ${current.operations.reduce((sum, item) => sum + item.fileCount, 0)} files and ${current.operations.reduce((sum, item) => sum + item.byteCount, 0)} bytes reclaimable.${current.status === "ready" ? ` Re-run with --apply --approval ${current.planId}.` : ""}\n`,
      );
      return current.status === "blocked" ? 1 : 0;
    }
    const receipt = await applyStatePrune({
      plan: current,
      approval: input.approval ?? "",
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

async function fileHash(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function inventory(
  root: string,
  current: string,
  result: Array<{ path: string; bytes: number; hash: string | null }>,
  budget: { bytes: number },
  bindContent: boolean,
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink())
      throw new Error("Derived state contains a symbolic link and cannot be reset safely.");
    const path = resolve(current, entry.name);
    if (entry.isDirectory()) await inventory(root, path, result, budget, bindContent);
    else if (entry.isFile()) {
      const stats = await lstat(path);
      budget.bytes += stats.size;
      result.push({
        path: relative(root, path).split(sep).join("/"),
        bytes: stats.size,
        hash: bindContent ? await fileHash(path) : null,
      });
    } else throw new Error("Derived state contains an unsupported filesystem entry.");
    if (result.length > 20_000 || budget.bytes > 2 * 1024 * 1024 * 1024)
      throw new Error("Derived state exceeds the bounded reset inventory.");
  }
}

async function plan(repositoryRoot: string, bindContent: boolean): Promise<StatePlan> {
  const root = resolve(repositoryRoot);
  if (bindContent) await assertNoKnowledgeMaterializationTransaction({ repositoryRoot: root });
  const state = resolveProjectPaths(root).state;
  const files: Array<{ path: string; bytes: number; hash: string | null }> = [];
  try {
    const stats = await lstat(state);
    if (!stats.isDirectory() || stats.isSymbolicLink())
      throw new Error("Derived state must be a physical directory.");
    await inventory(state, state, files, { bytes: 0 }, bindContent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const contentDigest = `sha256:${createHash("sha256").update(JSON.stringify(files)).digest("hex")}`;
  return {
    schemaVersion: 1,
    planKind: "derived_state_reset",
    planId: `kstatereset_${contentDigest.slice(7, 31)}`,
    repositoryRoot: root,
    status: files.length === 0 ? "current" : "ready",
    fileCount: files.length,
    totalBytes: files.reduce((total, item) => total + item.bytes, 0),
    contentDigest,
    durableDataPath: ".lervo/data",
    durableDataDisposition: "preserved",
  };
}

export async function runStateCommand(
  args: string[],
  io: CliIo,
  services: Pick<CliServices, "knowledgeMaterializationWait"> = {},
): Promise<number> {
  // Read-only; it must not wait on materialization or open a writable store.
  if (args[0] === "cas-retention") return runStateCasRetentionCommand(args.slice(1), io);
  try {
    const parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: true,
      options: {
        root: { type: "string" },
        json: { type: "boolean" },
        apply: { type: "boolean" },
        approval: { type: "string" },
        recover: { type: "string" },
        help: { type: "boolean", short: "h" },
      },
    });
    if (parsed.values.help) {
      io.stdout(`${stateUsage}\n`);
      return 0;
    }
    if (
      parsed.positionals.length !== 1 ||
      !["status", "prune", "reset"].includes(parsed.positionals[0]!)
    )
      throw new Error("Specify state status, prune, or reset.");
    const action = parsed.positionals[0]!;
    const repositoryRoot = resolve(io.cwd, parsed.values.root ?? ".");
    // Retention and reset classify any remaining marker; a live owner settles first.
    await foregroundKnowledgeMaterializationSettlement({
      repositoryRoot,
      io,
      timing: services.knowledgeMaterializationWait,
    }).settle();
    if (action === "prune") {
      if (parsed.values.recover !== undefined && (parsed.values.apply || parsed.values.approval))
        throw new Error("--recover cannot be combined with --apply or --approval.");
      return await runPrune({
        repositoryRoot,
        apply: parsed.values.apply ?? false,
        ...(parsed.values.approval === undefined ? {} : { approval: parsed.values.approval }),
        ...(parsed.values.recover === undefined ? {} : { recover: parsed.values.recover }),
        json: parsed.values.json ?? false,
        io,
      });
    }
    const current = await plan(repositoryRoot, action === "reset");
    if (parsed.positionals[0] === "status") {
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
          : `Derived state: ${current.fileCount} files, ${current.totalBytes} bytes (${current.status}). Durable .lervo/data is preserved.\n${current.status === "ready" ? `Re-run with --apply --approval ${current.planId}.\n` : ""}`,
      );
      return 0;
    }
    if (parsed.values.approval !== current.planId)
      throw new Error("--approval must equal the current state reset plan ID.");
    if (current.status === "ready") {
      const state = resolveProjectPaths(current.repositoryRoot).state;
      const tombstone = resolve(current.repositoryRoot, `.lervo/.state-reset-${current.planId}`);
      await rename(state, tombstone);
      await rm(tombstone, { recursive: true });
    }
    const receipt = {
      ...(await plan(current.repositoryRoot, false)),
      resetPlanId: current.planId,
      removedFiles: current.fileCount,
      removedBytes: current.totalBytes,
    };
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(receipt, null, 2)}\n`
        : `Reset derived state: ${current.fileCount} files, ${current.totalBytes} bytes. Durable .lervo/data was preserved.\n`,
    );
    return 0;
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${stateUsage}\n`);
    return 1;
  }
}
