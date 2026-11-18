import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { listAgents, registerAgent } from "@lervo/agent-workforce";
import { acquireFullCycleAdmission } from "@lervo/repository-knowledge-runtime";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli as runUnisolatedCli } from "../src/main.js";
import { commitRepository } from "./committed-repository.js";
import { agreeingCrossCheck } from "./plan-cross-check-fixture.js";
import * as terminalRuntime from "../src/terminal-runtime.js";
import { withIsolatedUpgradeHost } from "./upgrade-host-isolation.js";

const runCli = withIsolatedUpgradeHost(runUnisolatedCli);

const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
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

async function repository(): Promise<string> {
  const root = await temporary("lervo-upgrade-safe-");
  await writeFile(resolve(root, "main.ts"), "export const value = true;\n");
  expect(await runCli(["init", "--minimal", "--name", "safe-fixture"], io(root, [], []))).toBe(0);
  return root;
}

/** Applies the knowledge stages up to the terminal integration plan, then that plan. */
async function applyTerminalIntegration(root: string): Promise<void> {
  const migrate = async (...args: string[]) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    expect(
      await runCli(
        ["migrate", "knowledge", ...args, "--json"],
        io(root, stdout, stderr),
        agreeingCrossCheck,
      ),
      stderr.join(""),
    ).toBe(0);
    return JSON.parse(stdout.join("")) as { planKind?: string; planId: string };
  };
  for (let index = 0; index < 10; index += 1) {
    const plan = await migrate();
    // A reviewed knowledge plan lands as its own undo commit over committed sources.
    commitRepository(root);
    await migrate("--apply", plan.planId);
    if (plan.planKind === "terminal_integration") return;
  }
  throw new Error("Terminal integration plan did not become reachable.");
}

async function presentedPlan(root: string): Promise<{
  planId: string;
  status: string;
  stages: {
    terminalIntegration: { disposition: string; reason: string };
    knowledge: { disposition: string };
    workforce: { disposition: string; reason: string };
  };
}> {
  const stdout: string[] = [];
  expect(await runCli(["upgrade", "--json"], io(root, stdout, []))).toBe(0);
  return JSON.parse(stdout.join("")) as Awaited<ReturnType<typeof presentedPlan>>;
}

/**
 * Runs an apply while a background cycle holds the host admission, and changes repository bytes
 * during that wait, as a resident knowledge commit or a replica pull does.
 */
async function applyWhileRepositoryMoves(
  root: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  const directory = await temporary("lervo-upgrade-safe-admission-");
  const cycle = await acquireFullCycleAdmission({
    repositoryRoot: root,
    directory,
    signal: AbortSignal.timeout(5_000),
  });
  const stdout: string[] = [];
  const stderr: string[] = [];
  const running = runCli(args, io(root, stdout, stderr), {
    knowledgeCycleAdmission: { directory, pollMilliseconds: 20 },
  });
  await new Promise((done) => setTimeout(done, 150));
  await writeFile(resolve(root, "main.ts"), "export const value = false;\n");
  await cycle.release();
  const code = await running;
  return { code, stdout: stdout.join(""), stderr: stderr.join("") };
}

describe("lervo upgrade --apply (ADR-0561)", () => {
  it("plans and applies in one exclusive window when the plan changes while waiting", async () => {
    const root = await repository();
    await applyTerminalIntegration(root);
    // ADR-0539: an installed CLI publishes the host hook runtime at startup; runCli skips bin.ts.
    const hookReader = vi
      .spyOn(terminalRuntime, "hostTerminalHookReaderCurrent")
      .mockResolvedValue(true);
    await writeFile(resolve(root, "main.ts"), "export const value = 1;\n");
    const presented = await presentedPlan(root);
    expect(presented.stages.terminalIntegration.disposition).toBe("current");
    expect(presented.stages.knowledge.disposition).toBe("safe_apply");

    const result = await applyWhileRepositoryMoves(root, ["upgrade", "--apply", "--json"]);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    const receipt = JSON.parse(result.stdout) as {
      planId: string;
      appliedStages: string[];
      timing: { applyMs: number };
      stageTimings: Array<{ stage: string; ms: number }>;
    };
    // The plan recreated inside the window is what applied; no echoed plan ID can go stale.
    expect(receipt.planId).not.toBe(presented.planId);
    expect(receipt.appliedStages).toContain("knowledge_materialization");
    // ADR-0579: consecutive parts from the in-window plan to the final plan.
    const stages = receipt.stageTimings.map((timing) => timing.stage);
    expect(stages[0]).toBe("plan");
    expect(stages.at(-1)).toBe("final_plan");
    expect(stages).toEqual(
      expect.arrayContaining([
        "knowledge",
        "node_inspection",
        "knowledge_lint",
        "runtime_retention",
      ]),
    );
    for (const timing of receipt.stageTimings)
      expect(Number.isInteger(timing.ms) && timing.ms >= 0).toBe(true);
    const measured = receipt.stageTimings.reduce((sum, timing) => sum + timing.ms, 0);
    expect(measured).toBeLessThanOrEqual(receipt.timing.applyMs + stages.length);
    // The event writer stage reads the hook runtime of the isolated home, never the host's.
    expect(hookReader.mock.calls.length).toBeGreaterThan(0);
    for (const [store] of hookReader.mock.calls)
      expect(store).toMatch(/lervo-upgrade-home-[^/]+\/\.lervo\/terminal-hooks$/u);
  }, 60_000);

  it("keeps --safe as an accepted spelling of the same one-window apply", async () => {
    const root = await repository();
    const result = await applyWhileRepositoryMoves(root, [
      "upgrade",
      "--apply",
      "--safe",
      "--json",
    ]);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      appliedStages: expect.arrayContaining(["knowledge_materialization"]),
    });
  }, 60_000);

  it("applies repository role bindings and provider hooks without an owner approval", async () => {
    const root = await repository();
    const roleDirectory = resolve(root, ".lervo/roles");
    const rolePath = resolve(roleDirectory, "release-developer.json");
    await mkdir(roleDirectory, { recursive: true });
    const roleSource = (description: string) =>
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "lervo_repository_role",
        roleId: "release-developer",
        version: "1.0.0",
        extends: [{ roleId: "developer", version: "1.0.0" }],
        profile: { name: "Release Developer", description },
        checks: [],
      })}\n`;
    await writeFile(rolePath, roleSource("Prepares verified release artifacts."));
    const agent = await registerAgent({ repositoryRoot: root, roleId: "release-developer" });
    await writeFile(rolePath, roleSource("Prepares verified and reproducible release artifacts."));
    await mkdir(resolve(root, ".claude"), { recursive: true });
    const settings = '{ "permissions": { "allow": ["Read"] } }\n';
    await writeFile(resolve(root, ".claude/settings.json"), settings);

    const plan = await presentedPlan(root);
    expect(plan.stages.terminalIntegration).toMatchObject({
      disposition: "safe_apply",
      reason: "provider_hooks_backed_up_and_verified",
    });
    expect(plan.stages.workforce).toMatchObject({
      disposition: "safe_apply",
      reason: "stale_repository_role_bindings",
    });

    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runCli(["upgrade", "--apply", "--json"], io(root, stdout, stderr), {
      knowledgeCycleAdmission: { directory: await temporary("lervo-upgrade-safe-admission-") },
    });
    expect(code, stdout.join("") + stderr.join("")).toBe(0);
    const receipt = JSON.parse(stdout.join("")) as {
      appliedStages: string[];
      notices: Array<{ stage: string; undo: string }>;
    };
    expect(receipt.appliedStages).toEqual(
      expect.arrayContaining(["workforce_role_bindings", "terminal_integration"]),
    );
    expect((await listAgents(root))[0]).toMatchObject({ revision: agent.revision + 1 });
    const hooks = await readFile(resolve(root, ".claude/settings.json"), "utf8");
    expect(hooks).toContain("UserPromptSubmit");
    const terminal = receipt.notices.find((item) => item.stage === "terminal_integration");
    expect(terminal?.undo).toMatch(/^lervo state restore lbk_[a-f0-9]{24}$/u);

    // The notice's undo restores the provider hook file from its backup.
    expect(
      await runCli(terminal!.undo.split(" ").slice(1), io(root, [], stderr)),
      stderr.join(""),
    ).toBe(0);
    expect(await readFile(resolve(root, ".claude/settings.json"), "utf8")).toBe(settings);
  }, 60_000);

  it("fails the removed approval options briefly and points to the undo path", async () => {
    const root = await repository();
    for (const args of [
      ["upgrade", "--apply", "--approval", "upg_000000000000000000000000"],
      ["upgrade", "--apply", "--approve-role-binding=wrbop_x=sha256:0"],
    ]) {
      const stderr: string[] = [];
      expect(await runCli(args, io(root, [], stderr))).toBe(1);
      expect(stderr.join("")).toContain("--approval and --approve-role-binding were removed");
      expect(stderr.join("")).toContain("undo a stage with the command its receipt prints");
    }
    await expect(access(resolve(root, "docs/knowledge/index.md"))).rejects.toThrow();
  });
});
