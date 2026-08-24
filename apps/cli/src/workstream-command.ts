import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";

import { openProjectStorage } from "@lervo/project-storage";
import {
  applyWorkstreamStartPlan,
  applyWorkstreamUpdatePlan,
  createWorkstreamStartPlan,
  createWorkstreamUpdatePlan,
  formatWorkstreamContext,
  RepositoryKnowledgeError,
} from "@lervo/repository-knowledge";

import type { CliIo } from "./types.js";
import { verifiedCurrentWorkstream } from "./workstream-services.js";

export const workstreamUsage = `  lervo workstream current [--root <path>] [--context|--json]
  lervo workstream start (--from <json-path>|--stdin) [--actor <user|agent>] [--provider <codex|claude>] [--root <path>] [--apply <plan-id>] [--json]
  lervo workstream update (--from <json-path>|--stdin) [--actor <user|agent>] [--provider <codex|claude>] [--root <path>] [--apply <plan-id>] [--json]`;

async function boundedInput(path: string): Promise<string> {
  const content = await readFile(path, "utf8");
  if (Buffer.byteLength(content) > 64 * 1024) throw new Error("The workstream input exceeds 64 KiB.");
  return content;
}

async function runCurrent(args: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: { root: { type: "string" }, context: { type: "boolean" }, json: { type: "boolean" } },
  });
  if (parsed.values.context && parsed.values.json) throw new Error("Choose either --context or --json.");
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  const storage = await openProjectStorage(root);
  let snapshot;
  try { snapshot = await verifiedCurrentWorkstream(storage); }
  finally { await storage.close(); }
  if (snapshot === null) {
    io.stdout(parsed.values.json ? `${JSON.stringify({ schemaVersion: 1, status: "absent", repositoryRoot: root, workstream: null }, null, 2)}\n` : "No current Lervo workstream exists.\n");
    return 0;
  }
  if (parsed.values.json) {
    io.stdout(`${JSON.stringify({ schemaVersion: 1, status: "current", repositoryRoot: root, workstream: snapshot }, null, 2)}\n`);
  } else {
    io.stdout(`${formatWorkstreamContext(snapshot)}\n`);
  }
  return 0;
}

async function readJsonInput(values: { from?: string; stdin?: boolean }, io: CliIo): Promise<unknown> {
  if ((values.from === undefined) === !values.stdin) throw new Error("Choose exactly one of --from or --stdin.");
  const input = values.stdin ? await io.stdin?.() : await boundedInput(resolve(io.cwd, values.from!));
  if (input === undefined) throw new Error("Workstream JSON input is unavailable.");
  if (Buffer.byteLength(input) > 64 * 1024) throw new Error("The workstream input exceeds 64 KiB.");
  try { return JSON.parse(input); }
  catch { throw new Error("The workstream input must be valid JSON."); }
}

async function runStart(args: string[], io: CliIo): Promise<number> {
  const parsed = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      root: { type: "string" }, from: { type: "string" }, stdin: { type: "boolean" },
      actor: { type: "string" }, provider: { type: "string" }, apply: { type: "string" }, json: { type: "boolean" },
    },
  });
  if (parsed.values.actor !== undefined && parsed.values.actor !== "user" && parsed.values.actor !== "agent") throw new Error("--actor must be user or agent.");
  const actor = parsed.values.actor === "agent" ? "agent" as const : "user" as const;
  if (actor === "agent" && parsed.values.provider !== "codex" && parsed.values.provider !== "claude") throw new Error("--provider must be codex or claude when --actor agent is used.");
  if (actor === "user" && parsed.values.provider !== undefined) throw new Error("--provider is only valid with --actor agent.");
  const draft = await readJsonInput(parsed.values, io);
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  const storage = await openProjectStorage(root);
  try {
    const plan = await createWorkstreamStartPlan({ repositoryRoot: root, projectId: storage.manifest.projectId, draft });
    if (parsed.values.apply === undefined) {
      const printable = { ...plan, operations: plan.operations.map(({ content: _content, ...operation }) => operation) };
      io.stdout(parsed.values.json
        ? `${JSON.stringify(printable, null, 2)}\n`
        : plan.status === "blocked"
          ? `Workstream start is blocked.\n${plan.blockers.map((item) => `  [${item.code}] ${item.message}`).join("\n")}\n`
          : `Workstream start plan created.\nplan: ${plan.planId}\nworkstream: ${plan.snapshot?.workstreamId}\nrevision: 1\nNo state or event has been changed.\n`);
      return plan.status === "ready" ? 0 : 1;
    }
    if (parsed.values.apply !== plan.planId) throw new Error("The requested plan ID does not match the current workstream start plan.");
    const identity = randomUUID().replaceAll("-", "");
    const receipt = await applyWorkstreamStartPlan({
      plan,
      now: new Date(),
      actor,
      recordApplied: async (applied, snapshotContent) => {
        let artifact;
        try { artifact = await storage.artifacts.put(snapshotContent); }
        catch { throw new RepositoryKnowledgeError("knowledge_apply_failed", "The workstream start snapshot artifact could not be persisted."); }
        if (artifact.contentHash !== applied.snapshotContentHash) throw new RepositoryKnowledgeError("knowledge_apply_failed", "The persisted workstream snapshot differs from the start binding.");
        try { storage.events.append({
          eventId: `evt_${identity}`,
          projectId: applied.projectId,
          runId: `run_${identity}`,
          sessionId: `ses_${identity}`,
          type: "workstream.snapshot.recorded",
          occurredAt: applied.appliedAt,
          actor: actor === "agent" ? { kind: actor, provider: parsed.values.provider as "codex" | "claude" } : { kind: actor },
          schemaVersion: 1,
          policyVersion: applied.snapshotContentHash,
          payload: {
            workstreamId: applied.workstreamId,
            revision: applied.revision,
            status: applied.status,
            changeKind: applied.operation,
            snapshotArtifactId: `art_${applied.snapshotContentHash.slice("sha256:".length)}`,
            snapshotContentHash: applied.snapshotContentHash,
            previousSnapshotContentHash: null,
            sourceArtifactId: null,
            sourceContentHash: null,
            recordedAt: applied.appliedAt,
          },
        }); } catch (error) { throw new RepositoryKnowledgeError("knowledge_apply_failed", `The workstream start event could not be recorded: ${error instanceof Error ? error.message : "unknown event-store failure"}`); }
      },
    });
    io.stdout(parsed.values.json
      ? `${JSON.stringify(receipt, null, 2)}\n`
      : `Workstream started.\nworkstream: ${receipt.workstreamId}\nrevision: 1\nstatus: ${receipt.status}\n`);
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
      root: { type: "string" },
      from: { type: "string" },
      stdin: { type: "boolean" },
      actor: { type: "string" },
      provider: { type: "string" },
      apply: { type: "string" },
      json: { type: "boolean" },
    },
  });
  if (parsed.values.actor !== undefined && parsed.values.actor !== "user" && parsed.values.actor !== "agent") throw new Error("--actor must be user or agent.");
  const actor = parsed.values.actor === "agent" ? "agent" as const : "user" as const;
  if (actor === "agent" && parsed.values.provider !== "codex" && parsed.values.provider !== "claude") throw new Error("--provider must be codex or claude when --actor agent is used.");
  if (actor === "user" && parsed.values.provider !== undefined) throw new Error("--provider is only valid with --actor agent.");
  const snapshot = await readJsonInput(parsed.values, io);
  const root = resolve(io.cwd, parsed.values.root ?? ".");
  const storage = await openProjectStorage(root);
  try {
    const plan = await createWorkstreamUpdatePlan({ repositoryRoot: root, projectId: storage.manifest.projectId, snapshot });
    if (parsed.values.apply === undefined) {
      const printable = { ...plan, operations: plan.operations.map(({ content: _content, ...operation }) => operation) };
      io.stdout(parsed.values.json
        ? `${JSON.stringify(printable, null, 2)}\n`
        : plan.status === "blocked"
          ? `Workstream update is blocked.\n${plan.blockers.map((item) => `  [${item.code}] ${item.message}`).join("\n")}\n`
          : `Workstream update plan created.\nplan: ${plan.planId}\nworkstream: ${plan.snapshot?.workstreamId}\nrevision: ${plan.snapshot?.revision}\nNo state or event has been changed.\n`);
      return plan.status === "ready" ? 0 : 1;
    }
    if (parsed.values.apply !== plan.planId) throw new Error("The requested plan ID does not match the current workstream update plan.");
    const identity = randomUUID().replaceAll("-", "");
    const receipt = await applyWorkstreamUpdatePlan({
      plan,
      now: new Date(),
      actor,
      recordApplied: async (applied, snapshotContent) => {
        let artifact;
        try { artifact = await storage.artifacts.put(snapshotContent); }
        catch { throw new RepositoryKnowledgeError("knowledge_apply_failed", "The workstream update snapshot artifact could not be persisted."); }
        if (artifact.contentHash !== applied.snapshotContentHash) {
          throw new RepositoryKnowledgeError("knowledge_apply_failed", "The persisted workstream snapshot differs from the update binding.");
        }
        try { storage.events.append({
          eventId: `evt_${identity}`,
          projectId: applied.projectId,
          runId: `run_${identity}`,
          sessionId: `ses_${identity}`,
          type: "workstream.snapshot.recorded",
          occurredAt: applied.appliedAt,
          actor: actor === "agent" ? { kind: actor, provider: parsed.values.provider as "codex" | "claude" } : { kind: actor },
          schemaVersion: 1,
          policyVersion: applied.snapshotContentHash,
          payload: {
            workstreamId: applied.workstreamId,
            revision: applied.revision,
            status: applied.status,
            changeKind: applied.operation,
            snapshotArtifactId: `art_${applied.snapshotContentHash.slice("sha256:".length)}`,
            snapshotContentHash: applied.snapshotContentHash,
            previousSnapshotContentHash: applied.previousSnapshotContentHash,
            sourceArtifactId: null,
            sourceContentHash: null,
            recordedAt: applied.appliedAt,
          },
        }); } catch (error) { throw new RepositoryKnowledgeError("knowledge_apply_failed", `The workstream update event could not be recorded: ${error instanceof Error ? error.message : "unknown event-store failure"}`); }
      },
    });
    io.stdout(parsed.values.json
      ? `${JSON.stringify(receipt, null, 2)}\n`
      : `Workstream updated.\nworkstream: ${receipt.workstreamId}\nrevision: ${receipt.revision}\nstatus: ${receipt.status}\n`);
    return 0;
  } finally {
    await storage.close();
  }
}

export async function runWorkstreamCommand(args: string[], io: CliIo): Promise<number> {
  try {
    if (args[0] === "current") return await runCurrent(args.slice(1), io);
    if (args[0] === "start") return await runStart(args.slice(1), io);
    if (args[0] === "update") return await runUpdate(args.slice(1), io);
    throw new Error("Specify a supported workstream subcommand.");
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n${workstreamUsage}\n`);
    return 1;
  }
}
