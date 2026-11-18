import { mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { observeProcessCost } from "@lervo/repository-knowledge";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli as runUnisolatedCli } from "../src/main.js";
import * as terminalRuntime from "../src/terminal-runtime.js";
import * as stageInspection from "../src/upgrade-stage-inspection.js";
import { commitRepository } from "./committed-repository.js";
import { agreeingCrossCheck } from "./plan-cross-check-fixture.js";
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

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-upgrade-scan-reuse-"));
  roots.push(root);
  await writeFile(resolve(root, "main.ts"), "export const value = true;\n");
  await writeFile(resolve(root, "README.md"), "# Scan reuse fixture\n\nA small repository.\n");
  expect(await runCli(["init", "--minimal", "--name", "scan-reuse"], io(root, [], []))).toBe(0);
  return root;
}

/**
 * Applies every knowledge stage, through the provider hooks, so the next inspection walks every
 * stage plan. A reviewed plan is cross-checked by an agreeing fixture session and lands as its
 * own undo commit over committed sources (ADR-0561).
 */
async function migrateUntilCurrent(root: string): Promise<void> {
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
    return JSON.parse(stdout.join("")) as {
      planKind?: string;
      planId: string;
      status?: string;
      operations?: Array<{ action: string }>;
    };
  };
  for (let index = 0; index < 12; index += 1) {
    const plan = await migrate();
    const unchanged = plan.operations?.every((operation) => operation.action === "unchanged");
    if ((plan.status !== "ready" && plan.status !== "review_required") || unchanged === true)
      return;
    commitRepository(root);
    await migrate("--apply", plan.planId);
  }
  throw new Error("The knowledge migration did not become current.");
}

/** Repository scans started while `run` runs, counted by the scanner's own cost scope. */
async function scansDuring(run: () => Promise<unknown>): Promise<number> {
  const observer = observeProcessCost();
  try {
    await run();
    return observer.snapshot().scopes.scan?.calls ?? 0;
  } finally {
    observer.close();
  }
}

describe("upgrade knowledge inspection (ADR-0578)", () => {
  it("plans every knowledge stage from one repository scan", async () => {
    const root = await repository();
    await migrateUntilCurrent(root);

    const stdout: string[] = [];
    const scans = await scansDuring(() =>
      runCli(["migrate", "knowledge", "--integration-head", "--json"], io(root, stdout, [])),
    );
    const plan = JSON.parse(stdout.join("")) as { planKind?: string };
    // The last stage is reached only after the continuation, bootstrap, layout, structural,
    // bridge, and terminal integration plans are current.
    expect(plan.planKind).toBe("document_normalization_provider_selection");
    expect(scans).toBe(1);

    const inspectionScans = await scansDuring(() => stageInspection.inspectKnowledge(root));
    expect(inspectionScans).toBe(1);
  }, 120_000);

  it("scans once per scan input across a whole upgrade apply (ADR-0582)", async () => {
    const root = await repository();
    await migrateUntilCurrent(root);
    vi.spyOn(terminalRuntime, "hostTerminalHookReaderCurrent").mockResolvedValue(true);
    const stdout: string[] = [];
    const stderr: string[] = [];
    // The in-window plan, the knowledge step, lint, and the final plan read one unchanged tree.
    const scans = await scansDuring(() =>
      runCli(["upgrade", "--apply", "--json"], io(root, stdout, stderr)),
    );
    const receipt = JSON.parse(stdout.join("")) as { appliedStages?: string[] };
    expect(receipt.appliedStages, `${stdout.join("")}${stderr.join("")}`).toEqual(["event_writer"]);
    // One scan, and one more only when the event writer's own events change the evidence.
    expect(scans).toBeGreaterThanOrEqual(1);
    expect(scans).toBeLessThanOrEqual(2);
  }, 120_000);

  it("converges a source edit made after the plan inside the window in the same run", async () => {
    const root = await repository();
    await migrateUntilCurrent(root);
    // ADR-0539: an installed CLI publishes the host hook runtime at startup; runCli skips bin.ts.
    // The event writer stage then has work, so the plan has a stage to apply after knowledge.
    vi.spyOn(terminalRuntime, "hostTerminalHookReaderCurrent").mockResolvedValue(true);
    const presented: string[] = [];
    await runCli(["upgrade", "--json"], io(root, presented, []));
    const plan = JSON.parse(presented.join("")) as {
      planId: string;
      stages: { knowledge: { disposition: string } };
    };
    expect(plan.stages.knowledge.disposition).not.toBe("safe_apply");
    // A user, an agent, or a hook edits a source right after the plan inside the exclusion
    // inspected knowledge, before the knowledge step runs.
    const inspect = stageInspection.inspectKnowledge;
    // ADR-0582: the edit keeps the size and modification time, so only the fingerprint's change
    // time and bytes show it; the reused scan must not hide it from the knowledge step.
    const source = resolve(root, "main.ts");
    const before = await stat(source);
    vi.spyOn(stageInspection, "inspectKnowledge").mockImplementationOnce(async (target) => {
      const stage = await inspect(target);
      await writeFile(source, "export const value = null;\n");
      await utimes(source, before.atime, before.mtime);
      return stage;
    });

    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runCli(["upgrade", "--apply", "--json"], io(root, stdout, stderr));
    expect(stderr.join("")).toBe("");
    const receipt = JSON.parse(stdout.join("")) as { planId?: string; appliedStages?: string[] };
    // ADR-0561: the plan recreated inside the window is the one applied; the edit came after it.
    expect(receipt.planId, `${code} ${stdout.join("")}`).toBe(plan.planId);
    expect(receipt.appliedStages).toEqual(["knowledge_materialization", "event_writer"]);
  }, 120_000);
});
