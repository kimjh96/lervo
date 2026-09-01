import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createEventReaderCapabilities } from "@lervo/event-contract";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyEventWriterActivationPlan,
  applyInitPlan,
  createInitPlan,
  defaultEventWriterCoordinate,
  inspectEventWriterCoordinate,
  planEventWriterActivation,
  planEventWriterRollback,
  recoverEventWriterActivation,
} from "../src/index.js";

const roots: string[] = [];
const projectId = "prj_writer01";

async function fixture(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-event-writer-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId,
      now: new Date("2026-09-01T00:00:00.000Z"),
    }),
  );
  return root;
}

function evidence(readableEventSchemaVersions: readonly number[] = [1, 2]) {
  const capabilities = createEventReaderCapabilities();
  return {
    schemaVersion: 1 as const,
    projectId,
    observedAt: "2026-09-01T00:00:00.000Z",
    readers: [
      {
        readerId: "reader_local001",
        readerKind: "local" as const,
        peerIdentityHash: null,
        capabilities: {
          ...capabilities,
          readableEventSchemaVersions,
        },
      },
    ],
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("event writer activation", () => {
  it("keeps an absent coordinate on the implicit version 1 default", async () => {
    const root = await fixture();

    await expect(inspectEventWriterCoordinate(root)).resolves.toMatchObject({
      projectId,
      source: "implicit_default",
      contentHash: null,
      coordinate: { selectedEventSchemaVersion: 1, activationEvidence: null },
    });
  });

  it("creates a content-bound local activation plan and applies it exactly", async () => {
    const root = await fixture();
    const plan = await planEventWriterActivation({ repositoryRoot: root, evidence: evidence() });

    expect(plan).toMatchObject({
      status: "ready",
      operation: { action: "create", expectedCurrentHash: null },
      desiredCoordinate: { selectedEventSchemaVersion: 2 },
    });
    await expect(
      applyEventWriterActivationPlan({ plan, approval: "evplan_stale000000000000000" }),
    ).rejects.toMatchObject({ code: "event_writer_plan_stale" });

    const receipt = await applyEventWriterActivationPlan({ plan, approval: plan.planId });
    expect(receipt).toMatchObject({
      receiptKind: "event_writer_activation_applied",
      selectedEventSchemaVersion: 2,
      coordinateHash: plan.desiredContentHash,
    });
    await expect(inspectEventWriterCoordinate(root)).resolves.toMatchObject({
      source: "managed_file",
      coordinate: { selectedEventSchemaVersion: 2 },
    });
  });

  it("blocks an incapable local reader before mutation", async () => {
    const root = await fixture();

    await expect(
      planEventWriterActivation({ repositoryRoot: root, evidence: evidence([1]) }),
    ).rejects.toMatchObject({ code: "event_writer_activation_blocked" });
    await expect(
      readFile(resolve(root, ".lervo/data/event-contract.json"), "utf8"),
    ).rejects.toThrow();
  });

  it("requires authoritative inventory when Hub synchronization is enabled", async () => {
    const root = await fixture();
    const manifestPath = resolve(root, ".lervo/project.yaml");
    const manifest = await readFile(manifestPath, "utf8");
    await writeFile(
      manifestPath,
      manifest.replace("hubSyncEnabled: false", "hubSyncEnabled: true"),
    );

    const plan = await planEventWriterActivation({ repositoryRoot: root, evidence: evidence() });
    expect(plan.status).toBe("blocked");
    expect(plan.blockers).toContainEqual(
      expect.objectContaining({ code: "reader_inventory_authority_unavailable" }),
    );
  });

  it.each(["staged", "published"] as const)(
    "converges after an interruption at %s",
    async (checkpoint) => {
      const root = await fixture();
      const plan = await planEventWriterActivation({ repositoryRoot: root, evidence: evidence() });

      await expect(
        applyEventWriterActivationPlan({
          plan,
          approval: plan.planId,
          failureInjector: (current) => (current === checkpoint ? "interrupt" : undefined),
        }),
      ).rejects.toMatchObject({ code: "event_writer_recovery_required" });

      await expect(inspectEventWriterCoordinate(root)).rejects.toMatchObject({
        code: "event_writer_recovery_required",
      });

      await expect(recoverEventWriterActivation(root)).resolves.toMatchObject({
        status: checkpoint === "published" ? "completed" : "rolled_back",
        planId: plan.planId,
      });
      await expect(recoverEventWriterActivation(root)).resolves.toEqual({
        schemaVersion: 1,
        status: "current",
        planId: null,
      });
      await expect(inspectEventWriterCoordinate(root)).resolves.toMatchObject({
        coordinate: {
          selectedEventSchemaVersion: checkpoint === "published" ? 2 : 1,
        },
      });
    },
  );

  it("restores an existing version 1 coordinate after its move is interrupted", async () => {
    const root = await fixture();
    await mkdir(resolve(root, ".lervo/data"), { recursive: true });
    const before = `${JSON.stringify(defaultEventWriterCoordinate(projectId), null, 2)}\n`;
    await writeFile(resolve(root, ".lervo/data/event-contract.json"), before);
    const plan = await planEventWriterActivation({ repositoryRoot: root, evidence: evidence() });

    await expect(
      applyEventWriterActivationPlan({
        plan,
        approval: plan.planId,
        failureInjector: (checkpoint) =>
          checkpoint === "original_moved" ? "interrupt" : undefined,
      }),
    ).rejects.toMatchObject({ code: "event_writer_recovery_required" });
    await expect(recoverEventWriterActivation(root)).resolves.toMatchObject({
      status: "rolled_back",
    });
    await expect(readFile(resolve(root, ".lervo/data/event-contract.json"), "utf8")).resolves.toBe(
      before,
    );
  });

  it("returns the verified receipt when synchronous cleanup recovers an exact publication", async () => {
    const root = await fixture();
    const plan = await planEventWriterActivation({ repositoryRoot: root, evidence: evidence() });

    await expect(
      applyEventWriterActivationPlan({
        plan,
        approval: plan.planId,
        failureInjector: (checkpoint) => {
          if (checkpoint === "published") throw new Error("simulated cleanup failure");
        },
      }),
    ).resolves.toMatchObject({
      receiptKind: "event_writer_activation_applied",
      selectedEventSchemaVersion: 2,
    });
    await expect(recoverEventWriterActivation(root)).resolves.toMatchObject({
      status: "current",
    });
  });

  it("rolls back through a distinct plan and preserves version 2 on interruption", async () => {
    const root = await fixture();
    const activation = await planEventWriterActivation({
      repositoryRoot: root,
      evidence: evidence(),
    });
    await applyEventWriterActivationPlan({ plan: activation, approval: activation.planId });
    const rollback = await planEventWriterRollback(root);

    expect(rollback).toMatchObject({
      status: "ready",
      desiredCoordinate: { selectedEventSchemaVersion: 1, activationEvidence: null },
    });
    await expect(
      applyEventWriterActivationPlan({
        plan: rollback,
        approval: rollback.planId,
        failureInjector: (checkpoint) =>
          checkpoint === "original_moved" ? "interrupt" : undefined,
      }),
    ).rejects.toMatchObject({ code: "event_writer_recovery_required" });
    await expect(recoverEventWriterActivation(root)).resolves.toMatchObject({
      status: "rolled_back",
    });
    await expect(inspectEventWriterCoordinate(root)).resolves.toMatchObject({
      coordinate: { selectedEventSchemaVersion: 2 },
    });

    const retry = await planEventWriterRollback(root);
    await expect(
      applyEventWriterActivationPlan({ plan: retry, approval: retry.planId }),
    ).resolves.toMatchObject({
      receiptKind: "event_writer_rollback_applied",
      selectedEventSchemaVersion: 1,
    });
  });
});
