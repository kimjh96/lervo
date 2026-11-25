import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { openProjectStorage } from "@lervo/project-storage";
import {
  applyKnowledgeInstructionBridgePlan,
  applyKnowledgeMigrationPlan,
  applyTerminalIntegrationPlan,
  createKnowledgeInstructionBridgePlan,
  createKnowledgeMigrationPlan,
  createTerminalIntegrationPlan,
} from "@lervo/repository-knowledge";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "../src/main.js";
import { prefetchTerminalPromptContext } from "../src/terminal-knowledge-snapshot.js";
import {
  acquireTerminalTurnSettlementLease,
  listTerminalTurnSettlements,
  readTerminalTurnSettlementDrops,
  settledTerminalTurnEventId,
  type TerminalTurnSettlementRequest,
  writeTerminalTurnSettlement,
} from "../src/terminal-turn-settlement.js";
import { settleTerminalTurns } from "../src/terminal-turn-settlement-worker.js";

const run = promisify(execFile);
const roots: string[] = [];
/** Where Stop and the settlement worker queue a turn for its skill assessment. */
const skillQueue = ".lervo/state/knowledge/terminal-skills/queue";
const runtimeContent = "#!/usr/bin/env node\nprocess.stdout.write('{}\\n');\n";

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const git = (cwd: string, ...args: string[]) =>
  run("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=T", ...args], { cwd });

async function cli(cwd: string, args: string[], stdin?: string): Promise<string> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli(args, {
    cwd,
    stdout: (message) => out.push(message),
    stderr: (message) => err.push(message),
    ...(stdin === undefined ? {} : { stdin: async () => stdin }),
  });
  expect(code, `${args.join(" ")}: ${err.join("")}`).toBe(0);
  return out.join("");
}

/** A registered repository with Lervo's terminal integration whose writer selects `schema`. */
async function repository(schema: number) {
  const base = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-settle-")));
  roots.push(base);
  const state = resolve(base, "state");
  vi.stubEnv("LERVO_USER_STATE_DIRECTORY", state);
  const root = resolve(base, "main");
  await git(base, "init", "-q", "--initial-branch", "main", root);
  await writeFile(
    resolve(root, "AGENTS.md"),
    "# Agent instructions\n\nUse repository knowledge.\n",
  );
  await writeFile(resolve(root, "login.ts"), "export const maximum = 64;\n");
  await cli(root, ["init"]);
  await applyKnowledgeMigrationPlan(
    await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" }),
    new Date(),
    () => undefined,
  );
  const bridge = await createKnowledgeInstructionBridgePlan({
    repositoryRoot: root,
    provider: "claude",
  });
  await applyKnowledgeInstructionBridgePlan({
    plan: bridge,
    approvedOperationId: bridge.operationId,
    approvedHash: bridge.approvalHash,
    now: new Date(),
    recordApplied: () => undefined,
  });
  const terminal = await createTerminalIntegrationPlan(root, runtimeContent);
  await applyTerminalIntegrationPlan({
    plan: terminal,
    runtimeContent,
    now: new Date(),
    recordApplied: () => undefined,
  });
  const refreshed = await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" });
  if (refreshed.operations.some((item) => item.action !== "unchanged"))
    await applyKnowledgeMigrationPlan(refreshed, new Date(), () => undefined);
  await git(root, "add", "-A");
  await git(root, "commit", "-q", "-m", "base");
  await cli(root, [
    "repository",
    "register",
    "--root",
    root,
    "--registry",
    resolve(state, "repositories.json"),
    "--write",
    "--json",
  ]);
  const evidence = await cli(root, ["event-contract", "evidence", "--json"]);
  const version = String(schema);
  const planned = JSON.parse(
    await cli(
      root,
      ["event-contract", "activate", "--stdin", "--schema-version", version, "--json"],
      evidence,
    ),
  ) as { planId: string };
  await cli(
    root,
    [
      "event-contract",
      "activate",
      "--stdin",
      "--schema-version",
      version,
      "--apply",
      planned.planId,
      "--json",
    ],
    evidence,
  );
  await prefetchTerminalPromptContext(root);
  return root;
}

async function events(root: string, types: string[]) {
  const storage = await openProjectStorage(root);
  try {
    return storage.events.list({ types, limit: 1000 });
  } finally {
    await storage.close();
  }
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

const hook = (cwd: string, input: Record<string, unknown>) =>
  cli(cwd, ["terminal", "hook", "--provider", "claude", "--contract", "2"], JSON.stringify(input));

/** A settlement request for `contextEventId`, as a hook writes one. */
const request = (contextEventId: string, executionRoot: string): TerminalTurnSettlementRequest => ({
  schemaVersion: 1,
  provider: "claude",
  providerSessionDigest: `sha256:${"a".repeat(64)}`,
  contextEventId,
  ending: "next_prompt",
  executionRoot,
  afterObservationId: null,
  transcriptStart: null,
  transcriptEnd: null,
  requestedAt: new Date().toISOString(),
  attempts: 0,
});

const prompt = (cwd: string, turn: string, text = "Raise the password limit.") =>
  hook(cwd, {
    hook_event_name: "UserPromptSubmit",
    session_id: "settle-session",
    turn_id: turn,
    prompt: text,
  });

describe("turns that end without a Stop hook", () => {
  it("settles an interrupted turn at the next prompt, once, with its change and assessment", async () => {
    const root = await repository(12);
    await prompt(root, "turn-1");
    const [first] = await events(root, ["terminal.context.prepared"]);
    // The turn changes a file, and the owner interrupts it: no Stop hook runs.
    await writeFile(resolve(root, "login.ts"), "export const maximum = 1024;\n");
    await prompt(root, "turn-2", "Go on.");

    const [request] = await listTerminalTurnSettlements(root);
    expect(request).toMatchObject({
      contextEventId: first?.eventId,
      ending: "next_prompt",
      executionRoot: root,
      attempts: 0,
    });
    // Repository state names the session only by its digest.
    const directory = resolve(root, ".lervo/state/terminal-integration/turn-settlements");
    for (const name of await readdir(directory))
      expect(await readFile(resolve(directory, name), "utf8")).not.toContain("settle-session");
    expect(await settleTerminalTurns(root)).toBe(1);
    const [settled] = await events(root, ["terminal.turn.observed"]);
    expect(settled?.eventId).toBe(settledTerminalTurnEventId(first!.eventId));
    expect(settled?.schemaVersion).toBe(12);
    expect(settled?.payload).toMatchObject({
      contextEventId: first?.eventId,
      ending: "next_prompt",
      completionResult: "not_checked",
      repositoryChanged: true,
      referenceTelemetry: "unavailable",
    });
    expect(["current", "action_required"]).toContain(
      (settled?.payload as { lifecycleStatus: string }).lifecycleStatus,
    );
    const [change] = await events(root, ["repository.change.completed"]);
    expect(change?.payload).toMatchObject({ sourceEventId: settled?.eventId });
    expect(await exists(resolve(root, skillQueue, `${first!.eventId}.json`))).toBe(true);
    expect(await listTerminalTurnSettlements(root)).toEqual([]);

    // A second worker, or the same request written again, records nothing more.
    expect(await writeTerminalTurnSettlement(root, request!)).toBe(true);
    expect(await settleTerminalTurns(root)).toBe(0);
    expect(await events(root, ["terminal.turn.observed"])).toHaveLength(1);
    expect(await listTerminalTurnSettlements(root)).toEqual([]);
  }, 60_000);

  it("leaves a turn that Stop observed, and records nothing below schema 12", async () => {
    const root = await repository(12);
    await prompt(root, "turn-1");
    await hook(root, {
      hook_event_name: "Stop",
      session_id: "settle-session",
      turn_id: "turn-1",
      last_assistant_message: "Done.",
    });
    await prompt(root, "turn-2", "Go on.");
    expect(await listTerminalTurnSettlements(root)).toEqual([]);

    const older = await repository(11);
    await prompt(older, "turn-1");
    await prompt(older, "turn-2", "Go on.");
    await hook(older, {
      hook_event_name: "SessionStart",
      session_id: "settle-session",
      source: "resume",
    });
    expect(await listTerminalTurnSettlements(older)).toEqual([]);

    // A request a writer cannot record, as after an activation rollback, is dropped and counted.
    const [context] = await events(older, ["terminal.context.prepared"]);
    expect(await writeTerminalTurnSettlement(older, request(context!.eventId, older))).toBe(true);
    expect(await settleTerminalTurns(older)).toBe(0);
    expect(await listTerminalTurnSettlements(older)).toEqual([]);
    expect(await readTerminalTurnSettlementDrops(older)).toMatchObject({
      writer_below_schema_12: 1,
    });
  }, 60_000);

  it("runs one worker at a time and drops a request that keeps failing", async () => {
    const root = await repository(12);
    await prompt(root, "turn-1");
    const [context] = await events(root, ["terminal.context.prepared"]);
    // A checkout that is gone fails every attempt.
    const failing = request(context!.eventId, resolve(root, "gone"));
    expect(await writeTerminalTurnSettlement(root, failing)).toBe(true);

    // While another worker holds the lease, a second one leaves at once.
    const release = await acquireTerminalTurnSettlementLease(root);
    expect(release).not.toBeNull();
    expect(await settleTerminalTurns(root)).toBe(0);
    expect(await listTerminalTurnSettlements(root)).toMatchObject([{ attempts: 0 }]);
    await release!();

    expect(await settleTerminalTurns(root)).toBe(0);
    expect(await listTerminalTurnSettlements(root)).toMatchObject([{ attempts: 1 }]);
    await settleTerminalTurns(root);
    expect(await listTerminalTurnSettlements(root)).toMatchObject([{ attempts: 2 }]);
    await settleTerminalTurns(root);
    expect(await listTerminalTurnSettlements(root)).toEqual([]);
    expect(await readTerminalTurnSettlementDrops(root)).toMatchObject({ attempts_exhausted: 1 });
    expect(await events(root, ["terminal.turn.observed"])).toHaveLength(0);
  }, 60_000);

  it("settles the session's open turn when the session starts again", async () => {
    const root = await repository(12);
    await prompt(root, "turn-1");
    const [first] = await events(root, ["terminal.context.prepared"]);
    await hook(root, {
      hook_event_name: "SessionStart",
      session_id: "settle-session",
      source: "resume",
    });
    const [request] = await listTerminalTurnSettlements(root);
    expect(request).toMatchObject({
      contextEventId: first?.eventId,
      ending: "session_start",
      afterObservationId: null,
    });
    expect(await settleTerminalTurns(root)).toBe(1);
    const [settled] = await events(root, ["terminal.turn.observed"]);
    expect(settled?.payload).toMatchObject({
      ending: "session_start",
      completionResult: "not_checked",
      repositoryChanged: false,
    });
  }, 60_000);
});
