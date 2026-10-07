import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { openProjectStorage } from "@lervo/project-storage";
import {
  applyWorkstreamStartPlan,
  applyWorkstreamUpdatePlan,
  createWorkstreamRevisionPlan,
  createWorkstreamStartPlan,
  defaultWorkstreamFreshnessPolicy,
  formatWorkstreamContext,
  loadRepositoryKnowledgePolicy,
  workstreamFreshnessPolicy,
  type WorkstreamBookkeeping,
} from "@lervo/repository-knowledge";

import type { CliIo } from "./types.js";
import {
  parseWorkstreamActor,
  parseWorkstreamApplyMode,
  readWorkstreamChange,
  readWorkstreamDocument,
  workstreamWriteOptionSpec,
  type WorkstreamApplyMode,
} from "./workstream-command-input.js";
import { workstreamSnapshotRecorder } from "./workstream-recording.js";
import { observeRepositoryHead, observeWorkstreamFreshness } from "./workstream-repository-head.js";
import { verifiedCurrentWorkstream } from "./workstream-services.js";
import { runWorkstreamHubCommand, workstreamHubUsage } from "./workstream-hub-command.js";

const currentUsage = "  lervo workstream current [--root <path>] [--context|--json]";
const startUsage =
  "  lervo workstream start (--from <json-path>|--stdin) [--actor <user|agent>] [--provider <codex|claude>] [--root <path>] [--apply <plan-id>|--apply-now] [--json]";
const updateUsage =
  "  lervo workstream update (--patch <json>|--stdin-patch|--from <json-path>|--stdin) [--actor <user|agent>] [--provider <codex|claude>] [--root <path>] [--apply <plan-id>|--apply-now] [--json]";

export const workstreamUsage = [currentUsage, startUsage, updateUsage, workstreamHubUsage].join(
  "\n",
);

const writeDetails = `
The service sets revision (current + 1), updatedAt, and the observed repository HEAD, and carries
schemaVersion, workstreamId, and origin. Caller values for updatedAt and repositoryHead are ignored;
a supplied revision must equal current + 1. Notes keep the newest 32; droppedNoteCount records the rest.
Without --apply or --apply-now the command only plans and changes nothing. --apply <plan-id> applies
the exact plan the same input reproduces; --apply-now plans and applies that plan in one call.`;

const subcommandHelp = {
  current: `Usage:\n${currentUsage}\n`,
  start: `Usage:\n${startUsage}\n${writeDetails}\n`,
  update: `Usage:\n${updateUsage}\n${writeDetails}
--patch and --stdin-patch take an RFC 7386 JSON merge patch over the current snapshot: objects
merge, arrays replace, and null deletes. A top-level "appendNotes" string array appends notes.\n`,
} as const;

function wantsHelp(args: string[]): boolean {
  return args.includes("--help") || args.includes("-h");
}

async function bookkeepingNow(root: string): Promise<WorkstreamBookkeeping> {
  const now = new Date();
  return { recordedAt: now.toISOString(), repositoryHead: await observeRepositoryHead(root, now) };
}

function printablePlan<T extends { operations: Array<{ content?: unknown }> }>(plan: T) {
  return {
    ...plan,
    operations: plan.operations.map(({ content: _content, ...operation }) => operation),
  };
}

function blockedText(
  operation: string,
  blockers: Array<{ code: string; message: string }>,
): string {
  return `Workstream ${operation} is blocked.\n${blockers.map((item) => `  [${item.code}] ${item.message}`).join("\n")}\n`;
}

function requireMatchingPlan(mode: WorkstreamApplyMode, planId: string, operation: string): void {
  if (mode.kind === "apply" && mode.planId !== planId)
    throw new Error(
      `The requested plan ID does not match the current workstream ${operation} plan.`,
    );
}

async function runCurrent(args: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: { root: { type: "string" }, context: { type: "boolean" }, json: { type: "boolean" } },
  });
  if (parsed.values.context && parsed.values.json)
    throw new Error("Choose either --context or --json.");
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  const storage = await openProjectStorage(root);
  let snapshot;
  try {
    snapshot = await verifiedCurrentWorkstream(storage);
  } finally {
    await storage.close();
  }
  if (snapshot === null) {
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify({ schemaVersion: 1, status: "absent", repositoryRoot: root, workstream: null }, null, 2)}\n`
        : "No current Lervo workstream exists.\n",
    );
    return 0;
  }
  const freshness = await observeWorkstreamFreshness({
    root,
    snapshot,
    policy: await loadRepositoryKnowledgePolicy(root).then(
      workstreamFreshnessPolicy,
      () => defaultWorkstreamFreshnessPolicy,
    ),
    observedAt: new Date(),
  });
  io.stdout(
    parsed.values.json
      ? `${JSON.stringify({ schemaVersion: 1, status: "current", repositoryRoot: root, workstream: snapshot, freshness }, null, 2)}\n`
      : `${formatWorkstreamContext(snapshot, freshness)}\n`,
  );
  return 0;
}

async function runStart(args: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: workstreamWriteOptionSpec,
  });
  const actor = parseWorkstreamActor(parsed.values);
  const mode = parseWorkstreamApplyMode(parsed.values);
  const draft = await readWorkstreamDocument(parsed.values, io);
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  const storage = await openProjectStorage(root);
  try {
    await verifiedCurrentWorkstream(storage);
    const plan = await createWorkstreamStartPlan({
      repositoryRoot: root,
      projectId: storage.manifest.projectId,
      draft,
      bookkeeping: await bookkeepingNow(root),
    });
    if (mode.kind === "plan_only" || plan.status === "blocked") {
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(printablePlan(plan), null, 2)}\n`
          : plan.status === "blocked"
            ? blockedText("start", plan.blockers)
            : `Workstream start plan created.\nplan: ${plan.planId}\nworkstream: ${plan.snapshot?.workstreamId}\nrevision: 1\nNo state or event has been changed. Apply with --apply ${plan.planId}, or plan and apply in one call with --apply-now.\n`,
      );
      return plan.status === "ready" ? 0 : 1;
    }
    requireMatchingPlan(mode, plan.planId, "start");
    const receipt = await applyWorkstreamStartPlan({
      plan,
      now: new Date(),
      actor: actor.kind,
      recordApplied: workstreamSnapshotRecorder({ storage, actor, operation: "start" }),
    });
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(receipt, null, 2)}\n`
        : `Workstream started.\nplan: ${receipt.planId}\nworkstream: ${receipt.workstreamId}\nrevision: 1\nstatus: ${receipt.status}\n`,
    );
    return 0;
  } finally {
    await storage.close();
  }
}

async function runUpdate(args: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      ...workstreamWriteOptionSpec,
      patch: { type: "string" },
      "stdin-patch": { type: "boolean" },
    },
  });
  const actor = parseWorkstreamActor(parsed.values);
  const mode = parseWorkstreamApplyMode(parsed.values);
  const change = await readWorkstreamChange(parsed.values, io);
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  const storage = await openProjectStorage(root);
  try {
    await verifiedCurrentWorkstream(storage);
    const plan = await createWorkstreamRevisionPlan({
      repositoryRoot: root,
      projectId: storage.manifest.projectId,
      change,
      bookkeeping: await bookkeepingNow(root),
    });
    if (mode.kind === "plan_only" || plan.status === "blocked") {
      io.stdout(
        parsed.values.json
          ? `${JSON.stringify(printablePlan(plan), null, 2)}\n`
          : plan.status === "blocked"
            ? blockedText("update", plan.blockers)
            : `Workstream update plan created.\nplan: ${plan.planId}\nworkstream: ${plan.snapshot?.workstreamId}\nrevision: ${plan.snapshot?.revision}\n${plan.droppedNotesThisRevision === 0 ? "" : `notes dropped by retention: ${plan.droppedNotesThisRevision}\n`}No state or event has been changed. Apply with --apply ${plan.planId}, or plan and apply in one call with --apply-now.\n`,
      );
      return plan.status === "ready" ? 0 : 1;
    }
    requireMatchingPlan(mode, plan.planId, "update");
    const receipt = await applyWorkstreamUpdatePlan({
      plan,
      now: new Date(),
      actor: actor.kind,
      recordApplied: workstreamSnapshotRecorder({ storage, actor, operation: "update" }),
    });
    io.stdout(
      parsed.values.json
        ? `${JSON.stringify(receipt, null, 2)}\n`
        : `Workstream updated.\nplan: ${receipt.planId}\nworkstream: ${receipt.workstreamId}\nrevision: ${receipt.revision}\nstatus: ${receipt.status}\n${plan.droppedNotesThisRevision === 0 ? "" : `notes dropped by retention: ${plan.droppedNotesThisRevision}\n`}`,
    );
    return 0;
  } finally {
    await storage.close();
  }
}

export async function runWorkstreamCommand(args: string[], io: CliIo): Promise<number> {
  const subcommand = args[0];
  if (subcommand === undefined || subcommand === "--help" || subcommand === "-h") {
    io.stdout(`Usage:\n${workstreamUsage}\n`);
    return subcommand === undefined ? 1 : 0;
  }
  try {
    if (subcommand === "sync" || subcommand === "reconcile") {
      if (wantsHelp(args)) {
        io.stdout(`Usage:\n${workstreamHubUsage}\n`);
        return 0;
      }
      return await runWorkstreamHubCommand(args, io);
    }
    if (
      (subcommand === "current" || subcommand === "start" || subcommand === "update") &&
      wantsHelp(args.slice(1))
    ) {
      io.stdout(subcommandHelp[subcommand]);
      return 0;
    }
    if (subcommand === "current") return await runCurrent(args.slice(1), io);
    if (subcommand === "start") return await runStart(args.slice(1), io);
    if (subcommand === "update") return await runUpdate(args.slice(1), io);
    throw new Error("Specify a supported workstream subcommand.");
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${workstreamUsage}\n`);
    return 1;
  }
}
