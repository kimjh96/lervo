import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createEventReaderCapabilities } from "@lervo/event-contract";
import {
  applyEventWriterActivationPlan,
  applyInitPlan,
  createInitPlan,
  defaultEventWriterCoordinate,
  inspectEventWriterCoordinate,
  planEventWriterActivation,
  recoverEventWriterActivation,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-writer-plan-binding-"));
  roots.push(root);
  const projectId = "prj_writerbinding";
  await applyInitPlan(await createInitPlan({ root, projectId }));
  const evidence = {
    schemaVersion: 1,
    projectId,
    observedAt: "2026-10-11T00:00:00.000Z",
    readers: [
      {
        readerId: "reader_local001",
        readerKind: "local",
        peerIdentityHash: null,
        capabilities: createEventReaderCapabilities(),
      },
    ],
  };
  const plan = await planEventWriterActivation({ repositoryRoot: root, evidence });
  const replacement = `${JSON.stringify(defaultEventWriterCoordinate(projectId), null, 2)}\n`;
  return { root, plan, replacement };
}

it("rejects changed publication bytes under an unchanged approved plan hash", async () => {
  const { root, plan, replacement } = await fixture();
  plan.desiredContent = replacement;
  await expect(
    applyEventWriterActivationPlan({ plan, approval: plan.planId }),
  ).rejects.toMatchObject({
    code: "event_writer_plan_stale",
  });
  expect((await inspectEventWriterCoordinate(root)).source).toBe("implicit_default");
  expect(await recoverEventWriterActivation(root)).toMatchObject({ status: "current" });
});

it("publishes and reports the admitted plan when caller-owned bytes change during apply", async () => {
  const { root, plan, replacement } = await fixture();
  const expected = structuredClone(plan);
  const pending = applyEventWriterActivationPlan({ plan, approval: plan.planId });
  plan.desiredContent = replacement;
  await expect(pending).resolves.toMatchObject({
    receiptKind: "event_writer_activation_applied",
    selectedEventSchemaVersion: 2,
    coordinateHash: expected.desiredContentHash,
  });
  expect(await readFile(resolve(root, ".lervo/data/event-contract.json"), "utf8")).toBe(
    expected.desiredContent,
  );
});

it("keeps publication receipts bound when the caller changes its plan after publication", async () => {
  const { root, plan, replacement } = await fixture();
  const expected = structuredClone(plan);
  await expect(
    applyEventWriterActivationPlan({
      plan,
      approval: plan.planId,
      failureInjector(checkpoint) {
        if (checkpoint === "published") {
          plan.desiredContent = replacement;
          plan.desiredContentHash = `sha256:${"f".repeat(64)}`;
        }
      },
    }),
  ).resolves.toMatchObject({
    receiptKind: "event_writer_activation_applied",
    selectedEventSchemaVersion: 2,
    coordinateHash: expected.desiredContentHash,
  });
  expect((await inspectEventWriterCoordinate(root)).coordinate).toEqual(expected.desiredCoordinate);
});

it.each(["staged", "published"] as const)(
  "recovers the admitted plan after caller mutation and interruption at %s",
  async (phase) => {
    const { root, plan, replacement } = await fixture();
    const expected = structuredClone(plan);
    await expect(
      applyEventWriterActivationPlan({
        plan,
        approval: plan.planId,
        failureInjector(checkpoint) {
          if (checkpoint === phase) {
            plan.desiredContent = replacement;
            plan.desiredContentHash = `sha256:${"f".repeat(64)}`;
            plan.currentContentHash = `sha256:${"e".repeat(64)}`;
            return "interrupt";
          }
        },
      }),
    ).rejects.toMatchObject({ code: "event_writer_recovery_required" });
    expect(await recoverEventWriterActivation(root)).toMatchObject({
      status: phase === "published" ? "completed" : "rolled_back",
      planId: expected.planId,
    });
    expect((await inspectEventWriterCoordinate(root)).coordinate.selectedEventSchemaVersion).toBe(
      phase === "published" ? 2 : 1,
    );
  },
);
