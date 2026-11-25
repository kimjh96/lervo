import { execFile } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
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
import { listQueuedInstructionCaptures } from "@lervo/repository-knowledge-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "../src/main.js";
import { inspectTerminalLifecycle } from "../src/terminal-lifecycle-inspection.js";

const run = promisify(execFile);
const roots: string[] = [];
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
  expect(code, err.join("")).toBe(0);
  return out.join("");
}

/** A registered repository with Lervo's terminal integration, committed, and a linked worktree. */
async function linkedWorktree() {
  const base = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-linked-")));
  roots.push(base);
  const state = resolve(base, "state");
  vi.stubEnv("LERVO_USER_STATE_DIRECTORY", state);
  const main = resolve(base, "main");
  await git(base, "init", "-q", "--initial-branch", "main", main);
  await writeFile(
    resolve(main, "AGENTS.md"),
    "# Agent instructions\n\nUse repository knowledge.\n",
  );
  await cli(main, ["init"]);
  await applyKnowledgeMigrationPlan(
    await createKnowledgeMigrationPlan({ repositoryRoot: main, mode: "migrate" }),
    new Date(),
    () => undefined,
  );
  const bridge = await createKnowledgeInstructionBridgePlan({
    repositoryRoot: main,
    provider: "claude",
  });
  await applyKnowledgeInstructionBridgePlan({
    plan: bridge,
    approvedOperationId: bridge.operationId,
    approvedHash: bridge.approvalHash,
    now: new Date(),
    recordApplied: () => undefined,
  });
  const terminal = await createTerminalIntegrationPlan(main, runtimeContent);
  await applyTerminalIntegrationPlan({
    plan: terminal,
    runtimeContent,
    now: new Date(),
    recordApplied: () => undefined,
  });
  const refreshed = await createKnowledgeMigrationPlan({ repositoryRoot: main, mode: "migrate" });
  if (refreshed.operations.some((item) => item.action !== "unchanged"))
    await applyKnowledgeMigrationPlan(refreshed, new Date(), () => undefined);
  await git(main, "add", "-A");
  await git(main, "commit", "-q", "-m", "base");
  await cli(main, [
    "repository",
    "register",
    "--root",
    main,
    "--registry",
    resolve(state, "repositories.json"),
    "--write",
    "--json",
  ]);
  // The repository's writer selects schema 10, which the plan ledger and stage records need.
  const evidence = await cli(main, ["event-contract", "evidence", "--json"]);
  const planned = JSON.parse(
    await cli(
      main,
      ["event-contract", "activate", "--stdin", "--schema-version", "10", "--json"],
      evidence,
    ),
  ) as { planId: string };
  await cli(
    main,
    [
      "event-contract",
      "activate",
      "--stdin",
      "--schema-version",
      "10",
      "--apply",
      planned.planId,
      "--json",
    ],
    evidence,
  );
  const worktree = resolve(base, "worktree");
  await git(main, "worktree", "add", "-q", "-b", "work", worktree);
  return { main, worktree };
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

describe("a linked worktree of a registered repository", () => {
  it("records its workstream, plan, turns, and owner prompts in the repository", async () => {
    const { main, worktree } = await linkedWorktree();

    // The workstream: events and the branch binding in the repository, the projection here.
    await cli(
      worktree,
      ["workstream", "start", "--stdin", "--apply-now", "--json"],
      JSON.stringify({
        schemaVersion: 1,
        title: "Fix the login form",
        objective: "Make the login form accept a long password.",
        status: "active",
        blockers: [],
        nextActions: [],
        notes: [],
        references: [],
        pendingApprovals: [],
        pendingDecisions: [],
      }),
    );
    expect(await events(main, ["workstream.snapshot.recorded"])).toHaveLength(1);
    expect(await exists(resolve(worktree, ".lervo/state/workstreams/current.json"))).toBe(true);
    expect(await exists(resolve(main, ".lervo/state/workstreams/current.json"))).toBe(false);
    const bindings = JSON.parse(
      await readFile(resolve(main, ".lervo/state/workstreams/bindings.json"), "utf8"),
    ) as { bindings: Record<string, string> };
    expect(Object.keys(bindings.bindings)).toEqual(["work"]);
    expect(await cli(main, ["workstream", "current"])).toBe(
      "No current Lervo workstream exists.\n",
    );

    // A plan item captured here is the repository's, and this checkout's prompts show it.
    await cli(worktree, ["plan", "add", "--title", "Check the password length limit"]);
    const plans = JSON.parse(await cli(main, ["plan", "list", "--json"])) as {
      items: { title: string }[];
    };
    expect(plans.items.map((item) => item.title)).toEqual(["Check the password length limit"]);

    const prompt = await hook(worktree, {
      hook_event_name: "UserPromptSubmit",
      session_id: "linked-session",
      turn_id: "turn-1",
      prompt: "Don't truncate passwords from now on.",
    });
    const context = (JSON.parse(prompt) as { hookSpecificOutput: { additionalContext: string } })
      .hookSpecificOutput.additionalContext;
    expect(context).toContain("Fix the login form");
    expect(context).toContain("Check the password length limit");
    const prepared = await events(main, ["terminal.context.prepared"]);
    expect(prepared).toHaveLength(1);
    expect(await listQueuedInstructionCaptures(main)).toHaveLength(1);

    // The turn changes a file and checkpoints the workstream; Stop records it in the repository.
    await writeFile(resolve(worktree, "login.ts"), "export const maximum = 1024;\n");
    await cli(worktree, [
      "workstream",
      "update",
      "--patch",
      JSON.stringify({ appendNotes: ["Raised the password limit."] }),
      "--apply-now",
    ]);
    await hook(worktree, {
      hook_event_name: "Stop",
      session_id: "linked-session",
      turn_id: "turn-1",
      last_assistant_message: "Raised the limit in login.ts.",
    });
    const [turn] = await events(main, ["terminal.turn.observed"]);
    expect(turn?.payload).toMatchObject({
      contextEventId: prepared[0]?.eventId,
      repositoryChanged: true,
      finalWorkstreamRevision: 2,
    });
    // Stop finds the checkpoint this checkout made: no workstream issue, whatever else it reports.
    const lifecycle = await inspectTerminalLifecycle(main, undefined, undefined, worktree);
    expect(lifecycle.issues.map((issue) => issue.code)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^workstream_/u)]),
    );
    // Before this change the checkout's own store held no workstream for it.
    const local = await inspectTerminalLifecycle(worktree);
    expect(local.issues.map((issue) => issue.code)).toContain("workstream_missing");
    // Branch changes are not the repository's, so no knowledge job sees them.
    expect(await events(main, ["repository.change.completed"])).toHaveLength(0);

    // Nothing landed in the worktree's own store, which goes when the worktree does.
    expect(
      await events(worktree, [
        "terminal.context.prepared",
        "terminal.turn.observed",
        "workstream.snapshot.recorded",
      ]),
    ).toHaveLength(0);
  }, 60_000);
});
