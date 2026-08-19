import { canonicalJson } from "@lervo/event-contract";
import {
  handleOutboundEventBatch,
  handleProjectRegistration,
  type HubSyncReadView,
} from "@lervo/hub-sync";
import { HubSyncSQLiteStore } from "@lervo/hub-sync-sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { HubTraceReader, type HubTraceSource } from "../src/index.js";
import {
  batch,
  databasePath,
  destinationId,
  eventChain,
  manifest,
  registration,
  removeTemporaryRoots,
} from "./fixture.js";

const acceptedAt = "2026-08-19T02:00:00.000Z";

function register(store: HubSyncSQLiteStore, project: ReturnType<typeof manifest>): void {
  handleProjectRegistration({ store, request: registration(project), acceptedAt });
}

function accept(
  store: HubSyncSQLiteStore,
  project: ReturnType<typeof manifest>,
  events: ReturnType<typeof eventChain>,
): void {
  handleOutboundEventBatch({
    store,
    batch: batch(project, events),
    acknowledgedAt: acceptedAt,
  });
}

afterEach(removeTemporaryRoots);

describe("Hub trace read model", () => {
  it("lists projects without event bodies and groups each project timeline by run", async () => {
    const store = await HubSyncSQLiteStore.open({ path: await databasePath() });
    const first = manifest("prj_trace_01");
    const second = manifest("prj_trace_02");
    register(store, second);
    accept(store, second, eventChain(second.projectId, [{ runId: "run_second_01" }]));
    register(store, first);
    accept(store, first, eventChain(first.projectId, [
      { runId: "run_first_001", sessionId: "ses_first_aa" },
      { runId: "run_first_001", sessionId: "ses_first_bb" },
      { runId: "run_first_002" },
    ]));
    const reader = new HubTraceReader(store);

    const projects = reader.listProjects();
    expect(projects.map((project) => ({
      projectId: project.projectId,
      eventCount: project.storedEventCount,
      runCount: project.runCount,
      cursor: project.cursor.seq,
    }))).toEqual([
      { projectId: first.projectId, eventCount: 3, runCount: 2, cursor: 3 },
      { projectId: second.projectId, eventCount: 1, runCount: 1, cursor: 1 },
    ]);
    expect(projects[0]).not.toHaveProperty("events");

    const project = reader.getProject({ destinationId, projectId: first.projectId });
    expect(project.runs).toEqual([
      expect.objectContaining({
        runId: "run_first_001",
        sessionIds: ["ses_first_aa", "ses_first_bb"],
        firstSeq: 1,
        lastSeq: 2,
        eventCount: 2,
        continuousEventCount: 2,
        bufferedEventCount: 0,
      }),
      expect.objectContaining({ runId: "run_first_002", firstSeq: 3, lastSeq: 3 }),
    ]);
    const run = reader.getRun({
      destinationId,
      projectId: first.projectId,
      runId: "run_first_001",
    });
    expect(run.events.map((item) => ({
      seq: item.event.seq,
      chainPosition: item.chainPosition,
      requestDigest: item.event.payload.requestDigest,
    }))).toEqual([
      { seq: 1, chainPosition: "continuous", requestDigest: "sha256:" + "0".repeat(63) + "1" },
      { seq: 2, chainPosition: "continuous", requestDigest: "sha256:" + "0".repeat(63) + "2" },
    ]);
    store.close();
  });

  it("keeps buffered run events visibly separate until the chain gap is filled", async () => {
    const store = await HubSyncSQLiteStore.open({ path: await databasePath() });
    const project = manifest("prj_trace_gap_01");
    const events = eventChain(project.projectId, [
      { runId: "run_gap_0001" },
      { runId: "run_gap_0001" },
      { runId: "run_gap_0002" },
      { runId: "run_gap_0002" },
    ]);
    register(store, project);
    accept(store, project, events.slice(2));
    const reader = new HubTraceReader(store);

    expect(reader.listProjects()[0]).toMatchObject({
      cursor: { seq: 0, eventHash: null },
      storedEventCount: 2,
      continuousEventCount: 0,
      bufferedEventCount: 2,
      runCount: 1,
    });
    expect(reader.getRun({
      destinationId,
      projectId: project.projectId,
      runId: "run_gap_0002",
    }).events.map((item) => item.chainPosition)).toEqual(["buffered", "buffered"]);

    accept(store, project, events.slice(0, 2));
    expect(reader.getProject({ destinationId, projectId: project.projectId })).toMatchObject({
      project: {
        cursor: { seq: 4, eventHash: events[3]!.eventHash },
        storedEventCount: 4,
        continuousEventCount: 4,
        bufferedEventCount: 0,
        runCount: 2,
      },
      runs: [
        { runId: "run_gap_0001", continuousEventCount: 2, bufferedEventCount: 0 },
        { runId: "run_gap_0002", continuousEventCount: 2, bufferedEventCount: 0 },
      ],
    });
    store.close();
  });

  it("retains the selection reason and verification evidence in one run timeline", async () => {
    const store = await HubSyncSQLiteStore.open({ path: await databasePath() });
    const project = manifest("prj_trace_evidence_01");
    const runId = "run_evidence_01";
    const hash = "sha256:" + "b".repeat(64);
    const events = eventChain(project.projectId, [
      {
        runId,
        type: "context.selected",
        payload: {
          documentId: "doc_agents_01",
          reasonCode: "path_rule",
          ruleId: "rule_agents_01",
          required: true,
          scope: "project",
        },
      },
      {
        runId,
        type: "document.loaded",
        payload: {
          evidenceReceiptId: "ctx_evidence_01",
          documentId: "doc_agents_01",
          contentHash: hash,
          byteCount: 128,
          scope: "project",
          sourceRevision: hash,
        },
      },
      {
        runId,
        type: "verification.completed",
        payload: {
          verificationId: "ver_aaaaaaaaaaaaaaaa",
          suiteId: "project.check",
          suiteHash: hash,
          repositoryRevision: hash,
          status: "passed",
          resultArtifactId: "art_" + "b".repeat(64),
          resultContentHash: hash,
          nonPassedCommandIds: [],
        },
      },
    ]);
    register(store, project);
    accept(store, project, events);

    const trace = new HubTraceReader(store).getRun({
      destinationId,
      projectId: project.projectId,
      runId,
    });
    expect(trace.events.map((item) => item.event.type)).toEqual([
      "context.selected",
      "document.loaded",
      "verification.completed",
    ]);
    expect(trace.events[0]?.event.payload).toMatchObject({
      documentId: "doc_agents_01",
      reasonCode: "path_rule",
      ruleId: "rule_agents_01",
    });
    expect(trace.events[2]?.event.payload).toMatchObject({
      verificationId: "ver_aaaaaaaaaaaaaaaa",
      status: "passed",
      resultArtifactId: "art_" + "b".repeat(64),
    });
    store.close();
  });

  it("produces the same projection after duplicate delivery and database restart", async () => {
    const path = await databasePath();
    const project = manifest("prj_trace_restart_01");
    const events = eventChain(project.projectId, [
      { runId: "run_restart_01" },
      { runId: "run_restart_01" },
    ]);
    const first = await HubSyncSQLiteStore.open({ path });
    register(first, project);
    const outbound = batch(project, events);
    handleOutboundEventBatch({ store: first, batch: outbound, acknowledgedAt: acceptedAt });
    const before = canonicalJson(new HubTraceReader(first).getProject({
      destinationId,
      projectId: project.projectId,
    }));
    handleOutboundEventBatch({
      store: first,
      batch: outbound,
      acknowledgedAt: "2026-08-19T03:00:00.000Z",
    });
    expect(canonicalJson(new HubTraceReader(first).getProject({
      destinationId,
      projectId: project.projectId,
    }))).toBe(before);
    first.close();

    const reopened = await HubSyncSQLiteStore.open({ path });
    expect(canonicalJson(new HubTraceReader(reopened).getProject({
      destinationId,
      projectId: project.projectId,
    }))).toBe(before);
    reopened.close();
  });

  it("uses one SQLite snapshot even when another connection registers a project mid-read", async () => {
    const path = await databasePath();
    const first = await HubSyncSQLiteStore.open({ path });
    const second = await HubSyncSQLiteStore.open({ path });
    const original = manifest("prj_trace_snapshot_01");
    const concurrent = manifest("prj_trace_snapshot_02");
    register(first, original);
    let injected = false;
    const source: HubTraceSource = {
      read: <T>(work: (view: HubSyncReadView) => T): T => first.read((view) => work({
        loadProject: (coordinate) => view.loadProject(coordinate),
        listProjectCoordinates: () => {
          const coordinates = view.listProjectCoordinates();
          if (!injected) {
            injected = true;
            register(second, concurrent);
          }
          return coordinates;
        },
      })),
    };

    expect(new HubTraceReader(source).listProjects().map((item) => item.projectId))
      .toEqual([original.projectId]);
    expect(new HubTraceReader(first).listProjects().map((item) => item.projectId))
      .toEqual([original.projectId, concurrent.projectId]);
    first.close();
    second.close();
  });

  it("returns stable not-found codes without inventing empty traces", async () => {
    const store = await HubSyncSQLiteStore.open({ path: await databasePath() });
    const reader = new HubTraceReader(store);
    expect(() => reader.getProject({ destinationId, projectId: "prj_missing_01" }))
      .toThrowError(expect.objectContaining({ code: "project_not_found" }));

    const project = manifest("prj_trace_empty_01");
    register(store, project);
    expect(() => reader.getRun({
      destinationId,
      projectId: project.projectId,
      runId: "run_missing_01",
    })).toThrowError(expect.objectContaining({ code: "run_not_found" }));
    store.close();
  });
});
