import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { observeProcessCost } from "@lervo/repository-knowledge";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli as runUnisolatedCli } from "../src/main.js";
import * as terminalRuntime from "../src/terminal-runtime.js";
import * as stageInspection from "../src/upgrade-stage-inspection.js";
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
 * Applies every knowledge stage with the approvals it asks for, through the provider hooks, so
 * the next inspection walks every stage plan.
 */
async function migrateUntilCurrent(root: string): Promise<void> {
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
      status?: string;
      operations?: Array<{ action: string }>;
      operationId?: string;
      approvalHash?: string | null;
    };
  };
  for (let index = 0; index < 12; index += 1) {
    const plan = await migrate();
    const approval =
      plan.approvalHash === undefined || plan.approvalHash === null
        ? []
        : ["--approve-item", `${plan.operationId}=${plan.approvalHash}`];
    const unchanged = plan.operations?.every((operation) => operation.action === "unchanged");
    if ((plan.status !== "ready" || unchanged === true) && approval.length === 0) return;
    await migrate("--apply", plan.planId, ...approval);
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

  it("does not inspect knowledge again when the approved plan left nothing to apply", async () => {
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
    const inspections = vi.spyOn(stageInspection, "inspectKnowledge");

    const stdout: string[] = [];
    const stderr: string[] = [];
    const code = await runCli(
      ["upgrade", "--apply", "--approval", plan.planId, "--json"],
      io(root, stdout, stderr),
    );
    expect(stderr.join("")).toBe("");
    const receipt = JSON.parse(stdout.join("")) as {
      approvedPlanId?: string;
      appliedStages?: string[];
    };
    expect(receipt.approvedPlanId, `${code} ${stdout.join("")}`).toBe(plan.planId);
    expect(receipt.appliedStages).toEqual(["event_writer"]);
    // The plan recreated inside the exclusion and the final plan; the knowledge step reuses the
    // first, because no stage wrote before it and it had nothing to apply.
    expect(inspections).toHaveBeenCalledTimes(2);
  }, 120_000);
});
