import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import { runEventContractCommand } from "../src/event-contract-command.js";
import type { CliIo } from "../src/types.js";

const roots: string[] = [];

async function fixture(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-event-contract-cli-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_cliwriter1",
      now: new Date("2026-09-01T00:00:00.000Z"),
    }),
  );
  return root;
}

function io(root: string, stdin = "") {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const value: CliIo = {
    cwd: root,
    stdin: async () => stdin,
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
  };
  return { value, stdout, stderr };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("event-contract command", () => {
  it("reports the implicit version 1 default", async () => {
    const root = await fixture();
    const output = io(root);

    await expect(runEventContractCommand(["status", "--json"], output.value)).resolves.toBe(0);
    expect(JSON.parse(output.stdout.join(""))).toMatchObject({
      source: "implicit_default",
      coordinate: { selectedEventSchemaVersion: 1 },
    });
  });

  it("keeps evidence, planning, and exact apply as separate steps", async () => {
    const root = await fixture();
    const evidenceOutput = io(root);
    await expect(
      runEventContractCommand(["evidence", "--json"], evidenceOutput.value),
    ).resolves.toBe(0);
    const evidence = evidenceOutput.stdout.join("");
    expect(JSON.parse(evidence)).toMatchObject({
      projectId: "prj_cliwriter1",
      readers: [{ readerKind: "local", capabilities: { readableEventSchemaVersions: [1, 2] } }],
    });

    const planOutput = io(root, evidence);
    await expect(
      runEventContractCommand(["activate", "--stdin", "--json"], planOutput.value),
    ).resolves.toBe(0);
    const plan = JSON.parse(planOutput.stdout.join(""));
    expect(plan).toMatchObject({ status: "ready", operation: { action: "create" } });
    expect(plan).not.toHaveProperty("desiredContent");

    const staleOutput = io(root, evidence);
    await expect(
      runEventContractCommand(
        ["activate", "--stdin", "--apply", "evplan_000000000000000000000000"],
        staleOutput.value,
      ),
    ).resolves.toBe(1);
    expect(staleOutput.stderr.join("")).toContain("event_writer_plan_stale");

    const applyOutput = io(root, evidence);
    await expect(
      runEventContractCommand(
        ["activate", "--stdin", "--apply", plan.planId, "--json"],
        applyOutput.value,
      ),
    ).resolves.toBe(0);
    expect(JSON.parse(applyOutput.stdout.join(""))).toMatchObject({
      receiptKind: "event_writer_activation_applied",
      selectedEventSchemaVersion: 2,
    });

    const rollbackPlanOutput = io(root);
    await expect(
      runEventContractCommand(["rollback", "--json"], rollbackPlanOutput.value),
    ).resolves.toBe(0);
    const rollbackPlan = JSON.parse(rollbackPlanOutput.stdout.join(""));
    expect(rollbackPlan).toMatchObject({
      status: "ready",
      desiredCoordinate: { selectedEventSchemaVersion: 1, activationEvidence: null },
    });

    const rollbackOutput = io(root);
    await expect(
      runEventContractCommand(
        ["rollback", "--apply", rollbackPlan.planId, "--json"],
        rollbackOutput.value,
      ),
    ).resolves.toBe(0);
    expect(JSON.parse(rollbackOutput.stdout.join(""))).toMatchObject({
      receiptKind: "event_writer_rollback_applied",
      selectedEventSchemaVersion: 1,
      activationId: null,
    });
  });

  it("rejects ambiguous and oversized evidence input", async () => {
    const root = await fixture();
    const ambiguous = io(root, "{}");
    await expect(
      runEventContractCommand(["activate", "--stdin", "--from", "evidence.json"], ambiguous.value),
    ).resolves.toBe(1);
    expect(ambiguous.stderr.join("")).toContain("exactly one");

    const oversized = io(root, " ".repeat(64 * 1024 + 1));
    await expect(runEventContractCommand(["activate", "--stdin"], oversized.value)).resolves.toBe(
      1,
    );
    expect(oversized.stderr.join("")).toContain("64 KiB");
  });
});
