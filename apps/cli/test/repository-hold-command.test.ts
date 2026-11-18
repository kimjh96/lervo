import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runRepositoryPass } from "../src/host-repository-pass.js";
import { runCli as runUnisolatedCli } from "../src/main.js";
import { withIsolatedUpgradeHost } from "./upgrade-host-isolation.js";

const runCli = withIsolatedUpgradeHost(runUnisolatedCli);
const roots: string[] = [];
const previous = process.env.LERVO_USER_STATE_DIRECTORY;

afterEach(async () => {
  if (previous === undefined) delete process.env.LERVO_USER_STATE_DIRECTORY;
  else process.env.LERVO_USER_STATE_DIRECTORY = previous;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function io(root: string, stdout: string[], stderr: string[]) {
  return {
    cwd: root,
    stdout: (message: string) => stdout.push(message),
    stderr: (message: string) => stderr.push(message),
  };
}

async function temporary(prefix: string): Promise<string> {
  const path = await mkdtemp(resolve(tmpdir(), prefix));
  roots.push(path);
  return path;
}

describe("the owner's repository hold (ADR-0561)", () => {
  it("holds a repository so an upgrade plans but applies no stage that changes it", async () => {
    process.env.LERVO_USER_STATE_DIRECTORY = await temporary("lervo-hold-user-state-");
    const root = await temporary("lervo-hold-repository-");
    await writeFile(resolve(root, "main.ts"), "export const value = true;\n");
    expect(await runCli(["init", "--minimal", "--name", "held-fixture"], io(root, [], []))).toBe(0);

    const held: string[] = [];
    const errors: string[] = [];
    expect(
      await runCli(
        ["repository", "hold", "--root", root, "--reason", "later", "--json"],
        io(root, held, errors),
      ),
      errors.join(""),
    ).toBe(0);
    expect(JSON.parse(held.join(""))).toMatchObject({
      operation: "repository_held",
      hold: { reason: "later" },
    });

    const planned: string[] = [];
    expect(await runCli(["upgrade", "--json"], io(root, planned, errors))).toBeLessThanOrEqual(1);
    const plan = JSON.parse(planned.join("")) as {
      hold: { reason: string | null } | null;
      stages: { knowledge: { disposition: string; reason: string } };
    };
    expect(plan.hold).toMatchObject({ reason: "later" });
    expect(plan.stages.knowledge).toMatchObject({
      disposition: "lervo_debt",
      reason: "owner_hold",
    });

    const applied: string[] = [];
    await runCli(["upgrade", "--apply", "--json"], io(root, applied, errors));
    const receipt = JSON.parse(applied.join("")) as { appliedStages: string[] };
    for (const stage of [
      "capabilities",
      "workforce_role_bindings",
      "terminal_integration",
      "knowledge_materialization",
      "repository_node",
      "event_writer",
    ])
      expect(receipt.appliedStages).not.toContain(stage);
    await expect(access(resolve(root, "docs/knowledge/index.md"))).rejects.toThrow();

    const attention: string[] = [];
    expect(await runCli(["application", "attention", "--json"], io(root, attention, errors))).toBe(
      0,
    );
    expect(JSON.parse(attention.join("")).items).toContainEqual(
      expect.objectContaining({
        kind: "held_effect",
        effect: "repository_hold",
        reasonCode: "owner_hold",
        requiresUserAction: false,
      }),
    );

    const listed: string[] = [];
    expect(await runCli(["repository", "holds", "--json"], io(root, listed, errors))).toBe(0);
    expect(JSON.parse(listed.join("")).holds).toHaveLength(1);
    expect(await runCli(["repository", "release", "--root", root], io(root, [], errors))).toBe(0);
    const after: string[] = [];
    await runCli(["upgrade", "--json"], io(root, after, errors));
    expect(JSON.parse(after.join(""))).toMatchObject({ hold: null });
  }, 120_000);

  it("makes the release follower skip a held repository without running any command", async () => {
    const calls: string[][] = [];
    const result = await runRepositoryPass(["/r/held", "/r/free"], {
      run: async (args) => {
        calls.push([...args]);
        return {
          kind: "result",
          status: "current",
          planId: null,
          applicableStages: [],
          appliedStages: [],
          pendingStages: [],
          timing: null,
        };
      },
      repositoryHeld: async (root) => root === "/r/held",
    });
    expect(result.repositories[0]).toMatchObject({
      repositoryRoot: "/r/held",
      outcome: "blocked",
      code: "repository_owner_hold",
      rounds: 0,
    });
    expect(calls.map((call) => call[2])).toEqual(["/r/free"]);
  });
});
