import { access, mkdtemp, readFile, rm, writeFile, symlink, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createEventReaderCapabilities } from "@lervo/event-contract";
import {
  applyInitPlan,
  createInitPlan,
  planEventWriterActivation,
  applyEventWriterActivationPlan,
  inspectEventWriterCoordinate,
  planEventWriterRollback,
  planReportStorageActivation,
  applyReportStorageActivation,
  inspectReportStorageCoordinate,
  recoverReportStorageActivation,
  type ReportStorageEvidence,
} from "../src/index.js";
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-report-selection-"));
  roots.push(root);
  const projectId = "prj_report_selection";
  await applyInitPlan(await createInitPlan({ root, projectId }));
  const eventEvidence = {
    schemaVersion: 1,
    projectId,
    observedAt: new Date().toISOString(),
    readers: [
      {
        readerId: "reader_selection",
        readerKind: "local",
        peerIdentityHash: null,
        capabilities: createEventReaderCapabilities(),
      },
    ],
  };
  const writerPlan = await planEventWriterActivation({
    repositoryRoot: root,
    evidence: eventEvidence,
    targetEventSchemaVersion: 6,
  });
  await applyEventWriterActivationPlan({
    plan: writerPlan,
    approval: writerPlan.planId,
    currentEvidence: eventEvidence,
  });
  const writer = await inspectEventWriterCoordinate(root);
  const evidence: ReportStorageEvidence = {
    schemaVersion: 1,
    projectId,
    observedAt: new Date().toISOString(),
    writerCoordinateHash: writer.contentHash!,
    readers: [
      {
        readerId: "reader_selection",
        peerIdentityHash: null,
        artifactHash: `sha256:${"a".repeat(64)}`,
        readableStorageFormats: [3, 4],
      },
    ],
    rollback: { artifactHash: `sha256:${"b".repeat(64)}`, readableStorageFormats: [3, 4] },
  };
  const plan = await planReportStorageActivation({ repositoryRoot: root, evidence });
  return {
    root,
    evidence,
    plan,
    current: resolve(root, ".lervo/data/report-storage.json"),
    pending: resolve(root, ".lervo/data/.report-storage-pending"),
  };
}
it("plans without effects and publishes immutable selection without creating the event database", async () => {
  const { root, evidence, plan, current } = await fixture();
  expect(await inspectReportStorageCoordinate(root)).toMatchObject({
    coordinate: null,
    contentHash: null,
  });
  await expect(access(current)).rejects.toMatchObject({ code: "ENOENT" });
  expect(
    await applyReportStorageActivation({ plan, approval: plan.planId, currentEvidence: evidence }),
  ).toMatchObject({ coordinateHash: plan.desiredContentHash });
  expect(await inspectReportStorageCoordinate(root)).toMatchObject({
    coordinate: plan.coordinate,
    contentHash: plan.desiredContentHash,
  });
  await expect(access(resolve(root, ".lervo/data/events.sqlite"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  expect((await planReportStorageActivation({ repositoryRoot: root, evidence })).status).toBe(
    "current",
  );
});
it("requires current exact reader inventory, compatible artifacts and rollback evidence", async () => {
  const { root, evidence } = await fixture();
  const invalid = [
    { ...evidence, readers: [] },
    { ...evidence, readers: [{ ...evidence.readers[0], readableStorageFormats: [3] }] },
    { ...evidence, rollback: { ...evidence.rollback, readableStorageFormats: [3] } },
    { ...evidence, readers: [{ ...evidence.readers[0], readerId: "reader_wrong" }] },
    {
      ...evidence,
      readers: [{ ...evidence.readers[0], peerIdentityHash: `sha256:${"c".repeat(64)}` }],
    },
    { ...evidence, unexpected: true },
  ];
  for (const candidate of invalid)
    await expect(
      planReportStorageActivation({ repositoryRoot: root, evidence: candidate }),
    ).rejects.toMatchObject({ code: "report_storage_invalid" });
  for (const candidate of [
    { ...evidence, observedAt: "2020-01-01T00:00:00.000Z" },
    { ...evidence, writerCoordinateHash: `sha256:${"0".repeat(64)}` },
  ])
    await expect(
      planReportStorageActivation({ repositoryRoot: root, evidence: candidate }),
    ).rejects.toMatchObject({ code: "report_storage_stale" });
});
it("rejects altered plans, wrong approval, changed reader evidence and writer rollback before apply", async () => {
  const { root, evidence, plan, current } = await fixture();
  for (const request of [
    { plan, approval: "wrong", currentEvidence: evidence },
    {
      plan: { ...plan, desiredContent: plan.desiredContent + " " },
      approval: plan.planId,
      currentEvidence: evidence,
    },
    {
      plan,
      approval: plan.planId,
      currentEvidence: {
        ...evidence,
        rollback: { ...evidence.rollback, artifactHash: `sha256:${"c".repeat(64)}` },
      },
    },
  ])
    await expect(applyReportStorageActivation(request)).rejects.toMatchObject({
      code: "report_storage_stale",
    });
  const rollback = await planEventWriterRollback(root);
  await applyEventWriterActivationPlan({ plan: rollback, approval: rollback.planId });
  await expect(
    applyReportStorageActivation({ plan, approval: plan.planId, currentEvidence: evidence }),
  ).rejects.toMatchObject({ code: "report_storage_stale" });
  await expect(access(current)).rejects.toMatchObject({ code: "ENOENT" });
});
it.each(["staged", "published"] as const)(
  "fences interrupted %s publication and recovers without overwriting",
  async (phase) => {
    const { root, evidence, plan, pending } = await fixture();
    await expect(
      applyReportStorageActivation({
        plan,
        approval: plan.planId,
        currentEvidence: evidence,
        failureInjector: (checkpoint) => {
          if (checkpoint === phase) throw new Error("interrupted");
        },
      }),
    ).rejects.toThrow("interrupted");
    await expect(inspectReportStorageCoordinate(root)).rejects.toMatchObject({
      code: "report_storage_recovery_required",
    });
    await recoverReportStorageActivation(root);
    expect(await inspectReportStorageCoordinate(root)).toMatchObject({
      coordinate: plan.coordinate,
    });
    await expect(access(pending)).rejects.toMatchObject({ code: "ENOENT" });
    await recoverReportStorageActivation(root);
  },
);
it("preserves a conflicting owner file and leaves recovery blocked", async () => {
  const { root, evidence, plan, current, pending } = await fixture();
  await expect(
    applyReportStorageActivation({
      plan,
      approval: plan.planId,
      currentEvidence: evidence,
      failureInjector: async (phase) => {
        if (phase === "staged") await writeFile(current, "owner bytes");
      },
    }),
  ).rejects.toMatchObject({ code: "EEXIST" });
  await expect(recoverReportStorageActivation(root)).rejects.toMatchObject({
    code: "report_storage_invalid",
  });
  expect(await readFile(current, "utf8")).toBe("owner bytes");
  await expect(access(pending)).resolves.toBeUndefined();
});
it("rejects redirected, oversized and tampered selection files", async () => {
  const { root, plan, current } = await fixture();
  const elsewhere = resolve(root, "owner.json");
  await writeFile(elsewhere, plan.desiredContent);
  await symlink(elsewhere, current);
  await expect(inspectReportStorageCoordinate(root)).rejects.toMatchObject({
    code: "report_storage_invalid",
  });
  await rm(current);
  await writeFile(current, " ".repeat(65537));
  await expect(inspectReportStorageCoordinate(root)).rejects.toMatchObject({
    code: "report_storage_invalid",
  });
  await writeFile(current, JSON.stringify({ ...plan.coordinate, activationId: "rsact_wrong" }));
  await expect(inspectReportStorageCoordinate(root)).rejects.toMatchObject({
    code: "report_storage_invalid",
  });
});
it("preserves the selected storage format when the event writer rolls back", async () => {
  const { root, evidence, plan } = await fixture();
  await applyReportStorageActivation({ plan, approval: plan.planId, currentEvidence: evidence });
  const rollback = await planEventWriterRollback(root);
  await applyEventWriterActivationPlan({ plan: rollback, approval: rollback.planId });
  expect(await inspectReportStorageCoordinate(root)).toMatchObject({ coordinate: plan.coordinate });
});

it("accepts a newer observation timestamp while keeping every approved capability binding", async () => {
  const { root, evidence, plan } = await fixture();
  await applyReportStorageActivation({
    plan,
    approval: plan.planId,
    currentEvidence: {
      ...evidence,
      observedAt: new Date(Date.parse(evidence.observedAt) + 1).toISOString(),
    },
  });
  expect(await inspectReportStorageCoordinate(root)).toMatchObject({ coordinate: plan.coordinate });
});

it("rejects a redirected data directory during inspection and recovery", async () => {
  const { root, evidence, plan, pending } = await fixture();
  await expect(
    applyReportStorageActivation({
      plan,
      approval: plan.planId,
      currentEvidence: evidence,
      failureInjector: (phase) => {
        if (phase === "staged") throw new Error("interrupted");
      },
    }),
  ).rejects.toThrow("interrupted");
  const data = resolve(root, ".lervo/data"),
    moved = resolve(root, "owner-data");
  await rename(data, moved);
  await symlink(moved, data, "dir");
  await expect(inspectReportStorageCoordinate(root)).rejects.toMatchObject({
    code: "report_storage_invalid",
  });
  await expect(recoverReportStorageActivation(root)).rejects.toMatchObject({
    code: "report_storage_invalid",
  });
  await expect(access(pending)).resolves.toBeUndefined();
  await expect(access(resolve(moved, "report-storage.json"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
