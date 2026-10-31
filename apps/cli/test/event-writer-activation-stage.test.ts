import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { applyInitPlan, createInitPlan, inspectEventWriterCoordinate } from "@lervo/project";
import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  activateLocalEventWriter,
  applyEventWriterStage,
  inspectEventWriterStage,
  type EventWriterStagePorts,
  defaultEventWriterStagePorts,
} from "../src/event-writer-activation-stage.js";
import { collectEventReaderActivationEvidence } from "../src/event-reader-inventory.js";
import { EventReaderInventoryError } from "../src/event-reader-inventory.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-event-writer-stage-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_event_writer_stage" }));
  const storage = await openProjectStorage(root);
  try {
    storage.events.append({
      eventId: "evt_writer_stage_history",
      projectId: "prj_event_writer_stage",
      runId: "run_writer_stage_history",
      sessionId: "ses_writer_stage_history",
      type: "run.requested",
      occurredAt: "2026-10-06T00:00:00.000Z",
      actor: { kind: "user" },
      schemaVersion: 1,
      policyVersion: `sha256:${"a".repeat(64)}`,
      payload: { requestDigest: `sha256:${"b".repeat(64)}`, role: "developer", risk: "low" },
    });
  } finally {
    await storage.close();
  }
  return root;
}

function ports(overrides: Partial<EventWriterStagePorts> = {}): EventWriterStagePorts {
  return {
    collectEvidence: (input) => collectEventReaderActivationEvidence(input),
    hookReader: async () => "current",
    now: () => new Date("2026-10-06T00:00:00.000Z"),
    ...overrides,
  };
}

describe("event writer activation stage", () => {
  it("plans a local-only activation, backs the store up, and applies schema 4", async () => {
    const root = await repository();
    const stage = await inspectEventWriterStage(root, ports());
    expect(stage).toMatchObject({
      disposition: "safe_apply",
      reason: "event_writer_activation_ready",
      currentSchemaVersion: 1,
      targetSchemaVersion: 4,
      authority: "local",
      blockers: [],
    });
    expect(stage.observationHash).toMatch(/^sha256:/u);

    const outcome = await applyEventWriterStage(root, stage, ports());
    expect(outcome).toMatchObject({
      status: "activated",
      receipt: { selectedEventSchemaVersion: 4 },
      backup: {
        path: ".lervo/data/event-writer-backups/schema-4",
        eventDatabase: "copied",
        coordinate: "absent",
      },
    });
    expect((await inspectEventWriterCoordinate(root)).coordinate.selectedEventSchemaVersion).toBe(
      4,
    );
    const backup = resolve(root, ".lervo/data/event-writer-backups/schema-4");
    expect((await stat(resolve(backup, "events.sqlite"))).mode & 0o777).toBe(0o600);
    const copy = new DatabaseSync(resolve(backup, "events.sqlite"), { readOnly: true });
    try {
      expect(
        (copy.prepare("SELECT count(*) AS count FROM events").get() as { count: number }).count,
      ).toBeGreaterThan(0);
    } finally {
      copy.close();
    }
    expect(JSON.parse(await readFile(resolve(backup, "backup.json"), "utf8"))).toMatchObject({
      kind: "event_writer_activation_backup",
      targetEventSchemaVersion: 4,
    });
    expect(await inspectEventWriterStage(root, ports())).toMatchObject({
      disposition: "current",
      currentSchemaVersion: 4,
    });
  });

  it("blocks behind a stale generated hook reader before collecting any evidence", async () => {
    const root = await repository();
    const collectEvidence = vi.fn();
    const stage = await inspectEventWriterStage(
      root,
      ports({ hookReader: async () => "stale", collectEvidence }),
    );
    expect(stage.disposition).toBe("blocked");
    expect(stage.blockers).toEqual([
      expect.objectContaining({
        code: "terminal_hook_reader_stale",
        message: expect.stringContaining("terminal_integration"),
      }),
    ]);
    expect(collectEvidence).not.toHaveBeenCalled();
  });

  it("reports an unreachable Hub reader with its exact remedy and never activates", async () => {
    const root = await repository();
    const blocked = ports({
      collectEvidence: async () => {
        throw new EventReaderInventoryError("reader_inventory_hub_unavailable", "unreachable");
      },
    });
    const stage = await inspectEventWriterStage(root, blocked);
    expect(stage.blockers[0]).toMatchObject({
      code: "reader_inventory_hub_unavailable",
      message: expect.stringContaining("Do not disable Hub synchronization"),
    });
    expect(await activateLocalEventWriter(root, blocked)).toEqual({
      status: "held",
      code: "reader_inventory_hub_unavailable",
    });
    expect((await inspectEventWriterCoordinate(root)).coordinate.selectedEventSchemaVersion).toBe(
      1,
    );
  });

  it("refuses an approved activation whose reader observation changed", async () => {
    const root = await repository();
    const stage = await inspectEventWriterStage(root, ports());
    await expect(
      applyEventWriterStage(
        root,
        { ...stage, observationHash: `sha256:${"0".repeat(64)}` },
        ports(),
      ),
    ).rejects.toMatchObject({ code: "event_writer_plan_stale" });
    expect((await inspectEventWriterCoordinate(root)).coordinate.selectedEventSchemaVersion).toBe(
      1,
    );
  });

  it("activates local-only checkouts automatically but leaves Node and Hub readers to upgrade", async () => {
    const local = await repository();
    expect(await activateLocalEventWriter(local, ports())).toMatchObject({
      status: "activated",
    });
    expect(await activateLocalEventWriter(local, ports())).toEqual({ status: "current" });

    const distributed = await repository();
    const fleet = ports({
      collectEvidence: async (input) => {
        const evidence = await collectEventReaderActivationEvidence(input);
        return {
          ...evidence,
          schemaVersion: 2,
          authority: {
            kind: "repository_node_fleet_v1",
            repositoryIdentityHash: `sha256:${"1".repeat(64)}`,
            inventoryHash: `sha256:${"2".repeat(64)}`,
          },
        } as never;
      },
    });
    expect((await activateLocalEventWriter(distributed, fleet)).status).toBe("held");
    expect(
      (await inspectEventWriterCoordinate(distributed)).coordinate.selectedEventSchemaVersion,
    ).toBe(1);
  });
});

it("checks the host reader for schema-4 launchers and holds legacy repository readers", async () => {
  const root = await repository();
  const knowledge = await import("@lervo/repository-knowledge");
  const { loadTerminalHookLauncher } = await import("../src/terminal-runtime.js");
  const launcher = await loadTerminalHookLauncher();
  const plan = await knowledge.createTerminalIntegrationPlan(root, launcher);
  await knowledge.applyTerminalIntegrationPlan({
    plan,
    runtimeContent: launcher,
    approvedOperationId: plan.operationId,
    approvedHash: plan.approvalHash!,
    now: new Date(),
    recordApplied: () => undefined,
  });
  const runtime = await import("../src/terminal-runtime.js");
  const host = vi.spyOn(runtime, "hostTerminalHookReaderCurrent").mockResolvedValue(true);
  try {
    expect(await defaultEventWriterStagePorts.hookReader(root)).toBe("current");
    host.mockResolvedValue(false);
    expect(await defaultEventWriterStagePorts.hookReader(root)).toBe("stale");
    const content = "#!/usr/bin/env node\n";
    await writeFile(resolve(root, ".lervo/generated/terminal-hooks/runtime-v2.mjs"), content);
    await writeFile(
      resolve(root, ".lervo/generated/terminal-hooks/runtime-v2.json"),
      JSON.stringify({
        schemaVersion: 1,
        kind: "lervo_terminal_hook_runtime",
        contractId: "lervo_terminal_hooks_v2",
        runtimePath: ".lervo/generated/terminal-hooks/runtime-v2.mjs",
        byteCount: Buffer.byteLength(content),
        contentHash: knowledge.sha256(content),
      }),
    );
    host.mockResolvedValue(true);
    expect(await defaultEventWriterStagePorts.hookReader(root)).toBe("stale");
  } finally {
    host.mockRestore();
  }
});
