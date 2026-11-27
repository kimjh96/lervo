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
import {
  prefetchTerminalPromptContext,
  repositoryKnowledgeSnapshotId,
} from "../src/terminal-knowledge-snapshot.js";
import { inspectTerminalLifecycle } from "../src/terminal-lifecycle-inspection.js";
import { verifiedCurrentWorkstream } from "../src/workstream-services.js";

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
  expect(code, `${args.join(" ")}: ${err.join("")}`).toBe(0);
  return out.join("");
}

/**
 * A registered repository with Lervo's terminal integration, committed, and a linked worktree.
 * Its knowledge snapshot is warm, as the resident keeps it, unless `warmRepository` is false.
 */
async function linkedWorktree(warmRepository = true) {
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
  if (warmRepository) await prefetchTerminalPromptContext(main);
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
    // Read as its own repository, the checkout has no history for its workstream.
    const local = await inspectTerminalLifecycle(worktree);
    expect(local.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^workstream_/u)]),
    );
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

  it("finds the repository by its store when this process's registry lacks it", async () => {
    const { main, worktree } = await linkedWorktree(false);
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
    // A process whose registry lacks the repository, such as a command run by hand beside an ADE
    // that keeps its own state directory, still reads and records the repository's store.
    vi.stubEnv("LERVO_USER_STATE_DIRECTORY", resolve(worktree, "..", "other-state"));
    const current = JSON.parse(await cli(worktree, ["workstream", "current", "--json"])) as {
      workstream: { title: string };
    };
    expect(current.workstream.title).toBe("Fix the login form");
    await cli(worktree, ["plan", "add", "--title", "Check long passwords", "--json"]);
    expect(await events(main, ["plan.item.captured"])).toHaveLength(1);
    expect(await exists(resolve(worktree, ".lervo/data/events.sqlite"))).toBe(false);
  });

  it("reads the repository's evidence in status commands and never unbinds the checkout", async () => {
    const { main, worktree } = await linkedWorktree();
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
    await hook(worktree, {
      hook_event_name: "UserPromptSubmit",
      session_id: "status-session",
      turn_id: "turn-1",
      prompt: "From now on, never truncate passwords.",
    });
    const projection = resolve(worktree, ".lervo/state/workstreams/current.json");
    expect(await exists(projection)).toBe(true);

    // An agent checks its work from the checkout, as one did in the ADE 0.5.0 canary.
    const capture = JSON.parse(
      await cli(worktree, ["knowledge", "instruction", "capture", "--json"]),
    ) as { queuedCount: number };
    expect(capture.queuedCount).toBe(1);
    // Status exits 1 while the lifecycle needs action; its report is what counts here.
    const out: string[] = [];
    await runCli(["terminal", "status", "--json"], {
      cwd: worktree,
      stdout: (message) => out.push(message),
      stderr: () => undefined,
    });
    const status = JSON.parse(out.join("")) as { issues: { code: string }[] };
    expect(status.issues.map((issue) => issue.code)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^workstream_/u)]),
    );
    await cli(worktree, ["terminal", "coverage", "--json"]);
    await cli(worktree, ["application", "attention", "--json"]);

    // The checkout keeps its projection and holds no bindings of its own; the repository keeps
    // the workspace branch's binding.
    expect(await exists(projection)).toBe(true);
    expect(await exists(resolve(worktree, ".lervo/state/workstreams/bindings.json"))).toBe(false);
    const bindings = JSON.parse(
      await readFile(resolve(main, ".lervo/state/workstreams/bindings.json"), "utf8"),
    ) as { bindings: Record<string, string> };
    expect(Object.keys(bindings.bindings)).toEqual(["work"]);
    expect(await events(worktree, ["terminal.context.prepared"])).toHaveLength(0);
  }, 60_000);

  it("ranks a worktree's prompts against the repository's knowledge and never scans its own", async () => {
    const { main, worktree } = await linkedWorktree(false);
    const knowledgeCache = (root: string) =>
      resolve(root, ".lervo/state/cache/terminal-knowledge-snapshot.json");

    // Cold: the prompt degrades at once instead of scanning the worktree until the deadline.
    const started = performance.now();
    const cold = JSON.parse(
      await hook(worktree, {
        hook_event_name: "UserPromptSubmit",
        session_id: "cold-session",
        turn_id: "turn-1",
        prompt: "Check the login form.",
      }),
    ) as { hookSpecificOutput: { additionalContext: string } };
    expect(cold.hookSpecificOutput.additionalContext).toContain(
      "Lervo context degraded (knowledge_inspection_failed)",
    );
    expect(performance.now() - started).toBeLessThan(10_000);
    expect(await exists(knowledgeCache(worktree))).toBe(false);

    // Stop's prefetch warms the worktree's file hashes and the repository's knowledge snapshot.
    await prefetchTerminalPromptContext(worktree);
    expect(await exists(knowledgeCache(worktree))).toBe(false);
    expect(
      await exists(resolve(worktree, ".lervo/state/cache/terminal-repository-snapshot.json")),
    ).toBe(true);
    const repositorySnapshot = await repositoryKnowledgeSnapshotId(main);
    expect(repositorySnapshot).toMatch(/^ksnap_[a-f0-9]{24}$/u);

    // Warm: the next prompt records its context against the repository's snapshot.
    await hook(worktree, {
      hook_event_name: "UserPromptSubmit",
      session_id: "warm-session",
      turn_id: "turn-1",
      prompt: "Check the login form.",
    });
    const [prepared] = await events(main, ["terminal.context.prepared"]);
    expect(prepared?.payload).toMatchObject({ sourceSnapshotId: repositorySnapshot });
    expect(await exists(knowledgeCache(worktree))).toBe(false);
  }, 60_000);

  it("binds a checkout's own branch first, so a single-root read keeps its projection", async () => {
    const { worktree } = await linkedWorktree();
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
    // A read that treats the checkout as its own repository, as unrouted commands did: before,
    // it bound the workstream to main, found the checkout's branch unbound, and cleared the
    // projection. Now it binds the checkout's branch and fails on the history this store lacks,
    // naming where that history is, and leaves the projection in place.
    const storage = await openProjectStorage(worktree);
    try {
      await expect(verifiedCurrentWorkstream(storage)).rejects.toThrow(
        "this linked worktree records into its own",
      );
    } finally {
      await storage.close();
    }
    const projection = JSON.parse(
      await readFile(resolve(worktree, ".lervo/state/workstreams/current.json"), "utf8"),
    ) as { workstreamId: string };
    const local = JSON.parse(
      await readFile(resolve(worktree, ".lervo/state/workstreams/bindings.json"), "utf8"),
    ) as { defaultBranch: string; bindings: Record<string, string> };
    expect(local).toMatchObject({
      defaultBranch: "main",
      bindings: { work: projection.workstreamId },
    });
  }, 60_000);
});
