import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { registerAgent } from "@lervo/agent-workforce";
import { acquireFullCycleAdmission } from "@lervo/repository-knowledge-runtime";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const roots: string[] = [];

afterEach(async () => {
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

/** Approves provider hooks once, so terminal integration no longer needs owner approval. */
async function approveTerminalIntegration(root: string): Promise<void> {
  const migrate = async (...args: string[]) => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    expect(
      await runCli(["migrate", "knowledge", ...args, "--json"], io(root, stdout, stderr)),
      stderr.join(""),
    ).toBe(0);
    return JSON.parse(stdout.join("")) as {
      planKind?: string;
      planId: string;
      operationId?: string;
      approvalHash?: string | null;
      userUpdates?: Array<{ operationId: string; approvalHash: string }>;
    };
  };
  const approvals = (plan: Awaited<ReturnType<typeof migrate>>) =>
    plan.userUpdates !== undefined
      ? plan.userUpdates.flatMap((item) => [
          "--approve-item",
          `${item.operationId}=${item.approvalHash}`,
        ])
      : plan.approvalHash === undefined || plan.approvalHash === null
        ? []
        : ["--approve-item", `${plan.operationId}=${plan.approvalHash}`];
  for (let index = 0; index < 10; index += 1) {
    const plan = await migrate();
    await migrate("--apply", plan.planId, ...approvals(plan));
    if (plan.planKind === "terminal_integration") return;
  }
  throw new Error("Terminal integration plan did not become reachable.");
}

async function presentedPlan(root: string): Promise<{
  planId: string;
  status: string;
  stages: { terminalIntegration: { disposition: string }; knowledge: { disposition: string } };
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

describe("lervo upgrade --apply --safe", () => {
  it("plans and applies in one exclusive window when the plan changes while waiting", async () => {
    const root = await repository();
    await approveTerminalIntegration(root);
    await writeFile(resolve(root, "main.ts"), "export const value = 1;\n");
    const presented = await presentedPlan(root);
    expect(presented.stages.terminalIntegration.disposition).toBe("current");
    expect(presented.stages.knowledge.disposition).toBe("safe_apply");

    const result = await applyWhileRepositoryMoves(root, [
      "upgrade",
      "--apply",
      "--safe",
      "--json",
    ]);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    const receipt = JSON.parse(result.stdout) as {
      approvedPlanId: string;
      appliedStages: string[];
    };
    expect(receipt.approvedPlanId).not.toBe(presented.planId);
    expect(receipt.appliedStages.length).toBeGreaterThan(0);
    expect(receipt.appliedStages).toContain("knowledge_materialization");
  }, 60_000);

  it("names the current plan and the changed stage when an exact approval went stale", async () => {
    const root = await repository();
    const presented = await presentedPlan(root);

    const result = await applyWhileRepositoryMoves(root, [
      "upgrade",
      "--apply",
      "--approval",
      presented.planId,
      "--json",
    ]);
    expect(result.code).toBe(1);
    const failure = JSON.parse(result.stdout) as {
      error: { code: string; message: string; currentPlanId: string; changes: string[] };
    };
    expect(failure.error.code).toBe("upgrade_plan_changed");
    expect(failure.error.currentPlanId).not.toBe(presented.planId);
    expect(failure.error.message).toContain(`The current plan is ${failure.error.currentPlanId}.`);
    expect(failure.error.changes).toEqual(
      expect.arrayContaining([expect.stringMatching(/^knowledge \(.*plan .+ -> .+\)$/u)]),
    );
    await expect(access(resolve(root, "docs/knowledge/index.md"))).rejects.toThrow();
  }, 60_000);

  it("refuses a plan with a stage that needs owner approval and names it", async () => {
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
    await registerAgent({ repositoryRoot: root, roleId: "release-developer" });
    await writeFile(rolePath, roleSource("Prepares verified and reproducible release artifacts."));
    const before = await readFile(resolve(root, "AGENTS.md"), "utf8").catch(() => null);

    const stdout: string[] = [];
    const code = await runCli(["upgrade", "--apply", "--safe", "--json"], io(root, stdout, []), {
      knowledgeCycleAdmission: { directory: await temporary("lervo-upgrade-safe-admission-") },
    });
    expect(code).toBe(1);
    const failure = JSON.parse(stdout.join("")) as {
      error: { code: string; message: string; stages: Array<{ stage: string }> };
    };
    expect(failure.error.code).toBe("upgrade_owner_approval_required");
    // Every stage that needs an owner is named, including unapproved provider hooks.
    expect(failure.error.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ stage: "workforce" }),
        { stage: "terminal_integration", reason: "provider_hook_approval_required" },
      ]),
    );
    expect(failure.error.message).toContain("workforce (");
    expect(await readFile(resolve(root, "AGENTS.md"), "utf8").catch(() => null)).toBe(before);
    await expect(access(resolve(root, "docs/knowledge/index.md"))).rejects.toThrow();
  }, 60_000);

  it("rejects --safe combined with an exact approval", async () => {
    const root = await repository();
    const stderr: string[] = [];
    expect(
      await runCli(
        ["upgrade", "--apply", "--safe", "--approval", "upg_000000000000000000000000"],
        io(root, [], stderr),
      ),
    ).toBe(1);
    expect(stderr.join("")).toContain("--safe must be used with --apply and without --approval.");
  });
});
