import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createEventReaderCapabilities } from "@lervo/event-contract";
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

function distributedEvidence(inventoryHash = `sha256:${"a".repeat(64)}`) {
  const capabilities = createEventReaderCapabilities();
  return {
    schemaVersion: 2 as const,
    projectId: "prj_cliwriter1",
    observedAt: "2026-09-01T09:00:00.000Z",
    authority: {
      kind: "repository_node_fleet_v1" as const,
      repositoryIdentityHash: `sha256:${"b".repeat(64)}`,
      inventoryHash,
    },
    readers: [
      {
        readerId: "reader_hub_000000000000000000000001",
        readerKind: "hub" as const,
        peerIdentityHash: `sha256:${"c".repeat(64)}`,
        capabilities,
      },
      {
        readerId: "reader_local_runtime",
        readerKind: "local" as const,
        peerIdentityHash: null,
        capabilities,
      },
      {
        readerId: "reader_node_000000000000000000000001",
        readerKind: "node" as const,
        peerIdentityHash: `sha256:${"d".repeat(64)}`,
        capabilities,
      },
    ],
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("event-contract command", () => {
  it("selects version 3 explicitly and revalidates local capabilities before applying", async () => {
    const root = await fixture();
    const observed = io(root);
    expect(await runEventContractCommand(["evidence"], observed.value)).toBe(0);
    const evidence = observed.stdout.join("");
    const planned = io(root, evidence);
    expect(
      await runEventContractCommand(
        ["activate", "--stdin", "--schema-version", "3"],
        planned.value,
      ),
    ).toBe(0);
    const plan = JSON.parse(planned.stdout.join(""));
    expect(plan.desiredCoordinate).toMatchObject({
      schemaVersion: 2,
      selectedEventSchemaVersion: 3,
    });
    const stale = io(root, evidence);
    expect(
      await runEventContractCommand(
        ["activate", "--stdin", "--schema-version", "3", "--apply", plan.planId],
        stale.value,
        {
          collectEvidence: async () => {
            const value = JSON.parse(evidence);
            value.readers[0].capabilities.readableEventSchemaVersions = [1, 2];
            return value;
          },
        },
      ),
    ).toBe(1);
    expect(stale.stderr.join("")).toContain("event_writer_plan_stale");
    const applied = io(root, evidence);
    expect(
      await runEventContractCommand(
        ["activate", "--stdin", "--schema-version", "3", "--apply", plan.planId],
        applied.value,
      ),
    ).toBe(0);
    expect(JSON.parse(applied.stdout.join(""))).toMatchObject({ selectedEventSchemaVersion: 3 });
    for (const args of [
      ["status", "--schema-version", "3"],
      ["activate", "--schema-version", "7"],
    ]) {
      const invalid = io(root, evidence);
      expect(await runEventContractCommand(args, invalid.value)).toBe(1);
      expect(invalid.stderr.join("")).toContain("activation only");
    }
  });
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
      readers: [
        { readerKind: "local", capabilities: { readableEventSchemaVersions: [1, 2, 3, 4, 5, 6] } },
      ],
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

  it("re-observes exact distributed authority for planning and apply", async () => {
    const root = await fixture();
    const manifestPath = resolve(root, ".lervo/project.yaml");
    await writeFile(
      manifestPath,
      (await readFile(manifestPath, "utf8")).replace(
        "hubSyncEnabled: false",
        "hubSyncEnabled: true",
      ),
    );
    const evidence = distributedEvidence();
    const collectEvidence = async () => evidence;
    const planOutput = io(root, JSON.stringify(evidence));
    await expect(
      runEventContractCommand(["activate", "--stdin", "--json"], planOutput.value, {
        collectEvidence,
      }),
    ).resolves.toBe(0);
    const plan = JSON.parse(planOutput.stdout.join(""));
    expect(plan).toMatchObject({ status: "ready" });
    expect(plan).not.toHaveProperty("activationEvidence");

    const applyOutput = io(root, JSON.stringify(evidence));
    await expect(
      runEventContractCommand(
        ["activate", "--stdin", "--apply", plan.planId, "--json"],
        applyOutput.value,
        { collectEvidence },
      ),
    ).resolves.toBe(0);
    expect(JSON.parse(applyOutput.stdout.join(""))).toMatchObject({
      selectedEventSchemaVersion: 2,
    });

    const staleRoot = await fixture();
    const staleManifestPath = resolve(staleRoot, ".lervo/project.yaml");
    await writeFile(
      staleManifestPath,
      (await readFile(staleManifestPath, "utf8")).replace(
        "hubSyncEnabled: false",
        "hubSyncEnabled: true",
      ),
    );
    const staleOutput = io(staleRoot, JSON.stringify(evidence));
    await expect(
      runEventContractCommand(["activate", "--stdin"], staleOutput.value, {
        collectEvidence: async () => distributedEvidence(`sha256:${"e".repeat(64)}`),
      }),
    ).resolves.toBe(1);
    expect(staleOutput.stderr.join("")).toContain("event_writer_plan_stale");
  });
});
