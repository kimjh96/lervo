import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const execute = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function gitRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-workstream-authoring-"));
  roots.push(root);
  expect(
    await runCli(["init"], { cwd: root, stdout: () => undefined, stderr: () => undefined }),
  ).toBe(0);
  await execute("git", ["-C", root, "init", "-q"]);
  await execute("git", ["-C", root, "config", "user.email", "lervo-test@example.invalid"]);
  await execute("git", ["-C", root, "config", "user.name", "Lervo Test"]);
  await writeFile(resolve(root, "README.md"), "# Authoring fixture\n");
  await execute("git", ["-C", root, "add", "README.md"]);
  await execute("git", ["-C", root, "commit", "-q", "-m", "fixture"]);
  return root;
}

async function run(root: string, args: string[], stdin?: string) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await runCli(args, {
    cwd: root,
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
    ...(stdin === undefined ? {} : { stdin: async () => stdin }),
  });
  return { code, stdout: stdout.join(""), stderr: stderr.join("") };
}

const draft = JSON.stringify({
  schemaVersion: 1,
  status: "active",
  title: "Authoring fixture",
  objective: "Exercise server-owned workstream bookkeeping.",
  nextActions: ["Start."],
  blockers: [],
  notes: [],
  references: [],
});

const agent = ["--actor", "agent", "--provider", "claude"];

describe("workstream authoring CLI", () => {
  it("prints usage and exits 0 for --help and -h on every subcommand", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-workstream-help-"));
    roots.push(root);
    for (const args of [
      ["workstream", "--help"],
      ["workstream", "-h"],
      ["workstream", "current", "--help"],
      ["workstream", "start", "-h"],
      ["workstream", "update", "--help"],
      ["workstream", "update", "--patch", "{}", "-h"],
    ]) {
      const result = await run(root, args);
      expect(result.code, args.join(" ")).toBe(0);
      expect(result.stdout).toContain("Usage:");
      expect(result.stderr).toBe("");
    }
    expect((await run(root, ["workstream", "update", "--help"])).stdout).toContain("--apply-now");
  });

  it("applies a merge patch in one call with server-owned revision, time, HEAD, and events", async () => {
    const root = await gitRepository();
    const { stdout: head } = await execute("git", ["-C", root, "rev-parse", "HEAD"]);
    const started = await run(
      root,
      ["workstream", "start", ...agent, "--stdin", "--apply-now", "--json"],
      draft,
    );
    expect(started.code, started.stderr).toBe(0);
    expect(JSON.parse(started.stdout)).toMatchObject({ operation: "agent_start", revision: 1 });

    const patch = JSON.stringify({
      nextActions: ["Verify."],
      appendNotes: ["Recorded by patch."],
      updatedAt: "2000-01-01T00:00:00.000Z",
    });
    const planned = await run(root, ["workstream", "update", ...agent, "--patch", patch, "--json"]);
    expect(planned.code, planned.stderr).toBe(0);
    const plan = JSON.parse(planned.stdout) as { planId: string; snapshot: { revision: number } };
    expect(plan.snapshot.revision).toBe(2);

    const applied = await run(root, [
      "workstream",
      "update",
      ...agent,
      "--patch",
      patch,
      "--apply-now",
      "--json",
    ]);
    expect(applied.code, applied.stderr).toBe(0);
    expect(JSON.parse(applied.stdout)).toMatchObject({
      operation: "agent_update",
      planId: plan.planId,
      revision: 2,
    });

    const current = JSON.parse((await run(root, ["workstream", "current", "--json"])).stdout) as {
      workstream: Record<string, unknown>;
      freshness: { status: string };
    };
    expect(current.workstream).toMatchObject({
      revision: 2,
      nextActions: ["Verify."],
      notes: ["Recorded by patch."],
      repositoryHead: { commit: head.trim() },
    });
    expect(current.workstream.updatedAt).not.toBe("2000-01-01T00:00:00.000Z");
    expect(Date.now() - Date.parse(String(current.workstream.updatedAt))).toBeLessThan(60_000);
    expect(current.freshness.status).toBe("current");

    // The two-step reviewed flow records the same event shape as the one-call flow.
    const stdinPatch = JSON.stringify({ status: "completed", nextActions: [] });
    const twoStepPlan = JSON.parse(
      (await run(root, ["workstream", "update", ...agent, "--stdin-patch", "--json"], stdinPatch))
        .stdout,
    ) as { planId: string };
    const twoStep = await run(
      root,
      ["workstream", "update", ...agent, "--stdin-patch", "--apply", twoStepPlan.planId],
      stdinPatch,
    );
    expect(twoStep.code, twoStep.stderr).toBe(0);

    const storage = await openProjectStorage(root);
    try {
      const recorded = storage.events
        .list()
        .filter((event) => event.type === "workstream.snapshot.recorded");
      expect(recorded.map((event) => [event.payload.changeKind, event.payload.revision])).toEqual([
        ["agent_start", 1],
        ["agent_update", 2],
        ["agent_update", 3],
      ]);
      expect(Object.keys(recorded[1]!.payload).sort()).toEqual(
        Object.keys(recorded[2]!.payload).sort(),
      );
      expect(recorded[1]!.actor).toEqual(recorded[2]!.actor);
      expect(JSON.stringify(recorded)).not.toContain("Recorded by patch.");
    } finally {
      await storage.close();
    }
  });

  it("keeps the newest notes and reports how many were dropped", async () => {
    const root = await gitRepository();
    expect((await run(root, ["workstream", "start", "--stdin", "--apply-now"], draft)).code).toBe(
      0,
    );
    const notes = Array.from({ length: 35 }, (_, index) => `note ${index}`);
    const result = await run(root, [
      "workstream",
      "update",
      "--patch",
      JSON.stringify({ appendNotes: notes }),
      "--apply-now",
    ]);
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain("notes dropped by retention: 3");
    const current = JSON.parse((await run(root, ["workstream", "current", "--json"])).stdout) as {
      workstream: { notes: string[]; droppedNoteCount: number };
    };
    expect(current.workstream.notes).toHaveLength(32);
    expect(current.workstream.notes[0]).toBe("note 3");
    expect(current.workstream.droppedNoteCount).toBe(3);
  });

  it("rejects conflicting inputs and a stale revision assertion", async () => {
    const root = await gitRepository();
    expect((await run(root, ["workstream", "start", "--stdin", "--apply-now"], draft)).code).toBe(
      0,
    );
    const both = await run(root, ["workstream", "update", "--patch", "{}", "--stdin"], "{}");
    expect(both.code).toBe(1);
    expect(both.stderr).toContain(
      "Choose exactly one of --patch, --stdin-patch, --from, or --stdin.",
    );
    const modes = await run(root, [
      "workstream",
      "update",
      "--patch",
      "{}",
      "--apply",
      "x",
      "--apply-now",
    ]);
    expect(modes.stderr).toContain("Choose either --apply <plan-id> or --apply-now.");
    const stale = await run(root, [
      "workstream",
      "update",
      "--patch",
      JSON.stringify({ revision: 9 }),
      "--apply-now",
    ]);
    expect(stale.code).toBe(1);
    expect(stale.stdout).toContain("[invalid_revision]");
  });
});
