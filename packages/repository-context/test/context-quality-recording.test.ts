import { DatabaseSync } from "node:sqlite";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { FileSystemCas } from "@lervo/cas";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { createEventReaderCapabilities } from "@lervo/event-contract";
import {
  applyInitPlan,
  createInitPlan,
  planEventWriterActivation,
  applyEventWriterActivationPlan,
  planEventWriterRollback,
  inspectEventWriterCoordinate,
  planReportStorageActivation,
  applyReportStorageActivation,
} from "@lervo/project";
import {
  openProjectStorage,
  createProjectStoragePool,
  createProjectStorageOpener,
} from "@lervo/project-storage";
import { canonicalHash } from "@lervo/search";
import {
  beginContextQualityStorageOpening,
  beginContextQualityObservationScope,
  recordContextQualityPreparation,
} from "../src/context-quality-recording.js";
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(
  sqlReports: boolean | "persistent" = false,
  targetEventSchemaVersion: 6 | 9 = 6,
) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-quality-record-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_qualityrecord" }));
  const evidence = {
    schemaVersion: 1,
    projectId: "prj_qualityrecord",
    observedAt: new Date().toISOString(),
    readers: [
      {
        readerId: "reader_local001",
        readerKind: "local",
        peerIdentityHash: null,
        capabilities: createEventReaderCapabilities(),
      },
    ],
  };
  const activate = async () => {
    const plan = await planEventWriterActivation({
      repositoryRoot: root,
      evidence,
      targetEventSchemaVersion,
    });
    await applyEventWriterActivationPlan({
      plan,
      approval: plan.planId,
      currentEvidence: evidence,
    });
    if (sqlReports === true)
      (
        await SQLiteEventStore.open({
          path: resolve(root, ".lervo/data/events.sqlite"),
          projectId: "prj_qualityrecord",
          writableEventSchemaVersion: 6,
          reportStorage: "sqlite_v1",
        })
      ).close();
    if (sqlReports === "persistent") {
      const writer = await inspectEventWriterCoordinate(root);
      const reportEvidence = {
        schemaVersion: 1,
        projectId: "prj_qualityrecord",
        observedAt: new Date().toISOString(),
        writerCoordinateHash: writer.contentHash,
        readers: [
          {
            readerId: "reader_local001",
            peerIdentityHash: null,
            artifactHash: canonicalHash("reader-build"),
            readableStorageFormats: [3, 4],
          },
        ],
        rollback: { artifactHash: canonicalHash("rollback-build"), readableStorageFormats: [3, 4] },
      };
      const reportPlan = await planReportStorageActivation({
        repositoryRoot: root,
        evidence: reportEvidence,
      });
      await applyReportStorageActivation({
        plan: reportPlan,
        approval: reportPlan.planId,
        currentEvidence: reportEvidence,
      });
    }
  };
  const input = {
    repositoryRoot: root,
    result: {
      requestId: "qreq_recordfixture",
      status: "unavailable" as const,
      plan: null,
      reasonCodes: ["context_binding_unavailable" as const],
      missingBindings: [],
    },
    bindings: null,
    originKind: "terminal" as const,
    adapterBuildId: canonicalHash("build"),
  };
  return { root, input, activate };
}
it("records quality evidence when the writer is at a later event schema version", async () => {
  const { input, root, activate } = await fixture(false, 9);
  await activate();
  expect(await recordContextQualityPreparation(input)).toMatchObject({ status: "recorded" });
  const storage = await openProjectStorage(root);
  try {
    expect(storage.events.list({ types: ["context.quality.prepared"] })).toHaveLength(1);
  } finally {
    await storage.close();
  }
});

it("records no quality event until the writer is explicitly activated", async () => {
  const { input, root } = await fixture();
  const open = vi.spyOn(FileSystemCas, "open");
  expect(await recordContextQualityPreparation(input)).toEqual({ status: "writer_not_active" });
  expect(open).not.toHaveBeenCalled();
  await expect(access(resolve(root, ".lervo/data/events.sqlite"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
it("stores one exact CAS report per attempt and rejects conflicting retries", async () => {
  const { input, root, activate } = await fixture();
  await activate();
  const first = await recordContextQualityPreparation(input);
  expect(first.status).toBe("recorded");
  expect(await recordContextQualityPreparation(input)).toEqual(first);
  expect(
    await recordContextQualityPreparation({
      ...input,
      result: { ...input.result, reasonCodes: ["context_contract_invalid"] },
    }),
  ).toEqual({ status: "unavailable" });
  const storage = await openProjectStorage(root);
  try {
    const events = storage.events.list({ types: ["context.quality.prepared"] });
    expect(events).toHaveLength(1);
    expect(events[0]!.schemaVersion).toBe(6);
    expect(events[0]!.payload).not.toHaveProperty("task");
    if (first.status !== "recorded") throw new Error("Expected receipt");
    const bytes = await storage.artifacts.get(`lervo-cas://sha256/${first.artifactHash.slice(7)}`);
    expect(JSON.parse(Buffer.from(bytes).toString())).toEqual({
      result: input.result,
      bindings: null,
    });
    expect(storage.events.verifyIntegrity().valid).toBe(true);
  } finally {
    await storage.close();
  }
});
it("retains schema-6 history after rollback and suppresses further quality writes", async () => {
  const { input, root, activate } = await fixture();
  await activate();
  expect((await recordContextQualityPreparation(input)).status).toBe("recorded");
  const rollback = await planEventWriterRollback(root);
  await applyEventWriterActivationPlan({ plan: rollback, approval: rollback.planId });
  expect(await recordContextQualityPreparation(input)).toEqual({ status: "writer_not_active" });
  const storage = await openProjectStorage(root);
  try {
    expect(storage.events.list({ types: ["context.quality.prepared"] })).toHaveLength(1);
    expect(storage.events.verifyIntegrity().valid).toBe(true);
  } finally {
    await storage.close();
  }
});

it("records production preparation with its resolved project and policy bindings", async () => {
  const { prepareRepositoryQualityContext } = await import("../src/repository-quality-context.js");
  const { root, activate } = await fixture();
  await activate();
  const prepared = await prepareRepositoryQualityContext({
    repositoryRoot: root,
    origin: "terminal",
    recordObservation: true,
    task: {
      intent: "inspect",
      continuation: "",
      targetPaths: [],
      artifactKinds: [],
      requestedActions: [],
      conversationLocale: null,
      publicationLocale: null,
      retrievalLanguages: [],
    },
    instructionMaximumBytes: 4096,
    evidenceMaximumBytes: 4096,
    retrieval: "completed",
    candidates: [],
    sourceSnapshotId: "snapshot_fixture",
    retrievalBuildId: "retrieval_fixture",
  });
  expect(prepared.result.plan).not.toBeNull();
  expect(prepared.recording?.status).toBe("recorded");
  const storage = await openProjectStorage(root);
  try {
    const event = storage.events.list({ types: ["context.quality.prepared"] })[0]!;
    expect(event.payload.planDigest).toBe(prepared.result.plan!.planDigest);
    expect(event.payload.policySetDigest).toBe(prepared.observationBindings!.policySetDigest);
  } finally {
    await storage.close();
  }
});

it("rechecks writer rollback after CAS preparation and emits no success receipt", async () => {
  const { input, root, activate } = await fixture();
  await activate();
  const original = FileSystemCas.prototype.put;
  let changed = false;
  vi.spyOn(FileSystemCas.prototype, "put").mockImplementation(async function (
    this: FileSystemCas,
    ...args: Parameters<typeof original>
  ) {
    const artifact = await original.apply(this, args);
    if (!changed) {
      changed = true;
      const plan = await planEventWriterRollback(root);
      await applyEventWriterActivationPlan({ plan, approval: plan.planId });
    }
    return artifact;
  });
  expect(await recordContextQualityPreparation(input)).toEqual({ status: "unavailable" });
  const storage = await openProjectStorage(root);
  try {
    expect(storage.events.list()).toHaveLength(0);
  } finally {
    await storage.close();
  }
});
it.each(["chain", "metadata", "schema"])(
  "rejects changed %s through a retained connection",
  async (kind) => {
    const { input, root, activate } = await fixture();
    await activate();
    expect((await recordContextQualityPreparation(input)).status).toBe("recorded");
    const database = new DatabaseSync(resolve(root, ".lervo/data/events.sqlite"));
    try {
      if (kind === "chain") {
        database.exec("DROP TRIGGER events_no_update");
        database.exec("UPDATE events SET occurred_at = '2026-10-09T00:00:00Z'");
      } else if (kind === "schema") database.exec("PRAGMA user_version = 999");
      else
        database.exec("UPDATE store_meta SET value = 'prj_wrongproject' WHERE key = 'project_id'");
    } finally {
      database.close();
    }
    expect(
      await recordContextQualityPreparation({
        ...input,
        result: { ...input.result, requestId: "qreq_aftertamper" },
      }),
    ).toEqual({ status: "unavailable" });
    const inspect = new DatabaseSync(resolve(root, ".lervo/data/events.sqlite"));
    try {
      expect(inspect.prepare("SELECT COUNT(*) AS count FROM events").get()).toMatchObject({
        count: 1,
      });
    } finally {
      inspect.close();
    }
  },
);
it("retains every concurrent attempt and deduplicates exact retries", async () => {
  const { input, root, activate } = await fixture();
  await activate();
  const inputs = Array.from({ length: 4 }, (_, i) => ({
    ...input,
    result: { ...input.result, requestId: `qreq_parallel_${i}` },
  }));
  const results = await Promise.all(
    inputs.flatMap((value) => [
      recordContextQualityPreparation(value),
      recordContextQualityPreparation(value),
    ]),
  );
  expect(results.every((r) => r.status === "recorded")).toBe(true);
  const storage = await openProjectStorage(root);
  try {
    expect(storage.events.list()).toHaveLength(4);
    expect(storage.events.verifyIntegrity().valid).toBe(true);
  } finally {
    await storage.close();
  }
});

it("records and retries through SQL without publishing CAS bodies", async () => {
  const { input, root, activate } = await fixture(true);
  await activate();
  const put = vi.spyOn(FileSystemCas.prototype, "put");
  const first = await recordContextQualityPreparation(input);
  expect(first.status).toBe("recorded");
  expect(await recordContextQualityPreparation(input)).toEqual(first);
  expect(put).not.toHaveBeenCalled();
  const storage = await openProjectStorage(root);
  try {
    if (first.status !== "recorded") throw new Error("Missing SQL receipt");
    const body = await storage.artifacts.get(`lervo-cas://sha256/${first.artifactHash.slice(7)}`);
    expect(JSON.parse(Buffer.from(body).toString())).toEqual({
      result: input.result,
      bindings: null,
    });
    expect(storage.events.list({ types: ["context.quality.prepared"] })).toHaveLength(1);
    expect(storage.events.verifyIntegrity().valid).toBe(true);
  } finally {
    await storage.close();
  }
});

it("rolls back the new SQL report when a retry conflicts with its event", async () => {
  const { input, root, activate } = await fixture(true);
  await activate();
  expect((await recordContextQualityPreparation(input)).status).toBe("recorded");
  expect(
    await recordContextQualityPreparation({
      ...input,
      result: { ...input.result, reasonCodes: ["context_contract_invalid"] },
    }),
  ).toEqual({ status: "unavailable" });
  const db = new DatabaseSync(resolve(root, ".lervo/data/events.sqlite"));
  try {
    expect(db.prepare("SELECT count(*) AS n FROM quality_reports").get()).toMatchObject({ n: 1 });
  } finally {
    db.close();
  }
});

it("does not fall back to CAS after a SQL recording failure", async () => {
  const { input, root, activate } = await fixture(true);
  await activate();
  expect((await recordContextQualityPreparation(input)).status).toBe("recorded");
  const db = new DatabaseSync(resolve(root, ".lervo/data/events.sqlite"));
  try {
    db.exec("UPDATE quality_report_chunks SET body = x'00' WHERE part = 0");
  } finally {
    db.close();
  }
  const put = vi.spyOn(FileSystemCas.prototype, "put");
  expect(await recordContextQualityPreparation(input)).toEqual({ status: "unavailable" });
  expect(put).not.toHaveBeenCalled();
});

it("drains concurrent SQL recordings and suppresses writes after writer rollback", async () => {
  const { input, root, activate } = await fixture(true);
  await activate();
  const results = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      recordContextQualityPreparation({
        ...input,
        result: { ...input.result, requestId: `qreq_sql_concurrent_${index}` },
      }),
    ),
  );
  expect(results.map((result) => result.status)).toEqual(Array(4).fill("recorded"));
  const rollback = await planEventWriterRollback(root);
  await applyEventWriterActivationPlan({ plan: rollback, approval: rollback.planId });
  expect(await recordContextQualityPreparation(input)).toEqual({ status: "writer_not_active" });
  const storage = await openProjectStorage(root);
  try {
    expect(storage.events.list({ types: ["context.quality.prepared"] })).toHaveLength(4);
  } finally {
    await storage.close();
  }
});

it.each([6, 9] as const)(
  "initializes SQL reports inside the first recording after persistent format selection at writer %s",
  async (version) => {
    const { root, input, activate } = await fixture("persistent", version);
    await activate();
    const path = resolve(root, ".lervo/data/events.sqlite");
    await expect(access(path)).rejects.toMatchObject({ code: "ENOENT" });
    const put = vi.spyOn(FileSystemCas.prototype, "put");
    expect((await recordContextQualityPreparation(input)).status).toBe("recorded");
    expect(put).not.toHaveBeenCalled();
    const db = new DatabaseSync(path);
    try {
      expect(db.prepare("PRAGMA user_version").get()).toMatchObject({ user_version: 4 });
      expect(db.prepare("SELECT count(*) AS n FROM quality_reports").get()).toMatchObject({ n: 1 });
    } finally {
      db.close();
    }
  },
);

it("rejects a retained lease when persistent format selection disappears before commit", async () => {
  const { root, activate } = await fixture("persistent");
  await activate();
  const pool = createProjectStoragePool(undefined, { minimumEventSchemaVersion: 6 });
  try {
    await expect(
      pool.run(root, async (_storage, assertCurrent) => {
        await rm(resolve(root, ".lervo/data/report-storage.json"));
        await assertCurrent();
      }),
    ).rejects.toMatchObject({ code: "storage_binding_changed" });
  } finally {
    await pool.close();
  }
});

it("rejects a backend that silently ignores persistent report selection", async () => {
  const { root, activate } = await fixture("persistent");
  await activate();
  const open = createProjectStorageOpener({
    openEventStore: ({ path, projectId, writableEventSchemaVersion }) =>
      SQLiteEventStore.open({ path, projectId, writableEventSchemaVersion }),
    openArtifactStore: (root) => FileSystemCas.open(root),
  });
  await expect(open(root)).rejects.toMatchObject({ code: "storage_layout_invalid" });
});

it.each([false, "persistent"] as const)(
  "uses the opening hint only for scheduling and preserves %s storage behavior",
  async (selection) => {
    const { root, input, activate } = await fixture(selection);
    await activate();
    const opening = await beginContextQualityStorageOpening(root);
    expect(opening).toEqual({ status: "available", reportWriting: selection === "persistent" });
    if (opening.status !== "available") throw new Error("opening unavailable");
    const cas = vi.spyOn(FileSystemCas.prototype, "put");
    const seal = beginContextQualityObservationScope(
      root,
      input.result.requestId,
      opening.reportWriting,
    );
    const recording = recordContextQualityPreparation(input);
    seal?.();
    const receipt = await recording;
    expect(receipt.status).toBe("recorded");
    if (receipt.status !== "recorded") throw new Error("receipt unavailable");
    const storage = await openProjectStorage(root);
    try {
      const report = storage.events.reports!.getReport(receipt.artifactHash);
      expect(report !== null).toBe(selection === "persistent");
      const bytes = await storage.artifacts.get(
        `lervo-cas://sha256/${receipt.artifactHash.slice(7)}`,
      );
      expect(JSON.parse(Buffer.from(bytes).toString())).toEqual({
        result: input.result,
        bindings: null,
      });
      expect(storage.events.verifyIntegrity().eventCount).toBe(1);
      if (selection === "persistent") expect(cas).not.toHaveBeenCalled();
      else expect(cas).toHaveBeenCalled();
    } finally {
      await storage.close();
    }
  },
);

it("rejects a writer rollback after a SQL scheduling hint before any report publication", async () => {
  const { root, input, activate } = await fixture("persistent");
  await activate();
  expect(await beginContextQualityStorageOpening(root)).toEqual({
    status: "available",
    reportWriting: true,
  });
  const rollback = await planEventWriterRollback(root);
  await applyEventWriterActivationPlan({ plan: rollback, approval: rollback.planId });
  const seal = beginContextQualityObservationScope(root, input.result.requestId, true);
  const recording = recordContextQualityPreparation(input);
  seal?.();
  expect(await recording).toEqual({ status: "writer_not_active" });
  const database = new DatabaseSync(resolve(root, ".lervo/data/events.sqlite"));
  try {
    expect(database.prepare("SELECT count(*) AS n FROM events").get()).toMatchObject({ n: 0 });
    expect(database.prepare("SELECT count(*) AS n FROM quality_reports").get()).toMatchObject({
      n: 0,
    });
  } finally {
    database.close();
  }
});
