import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { FileSystemCas } from "@lervo/cas";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { operatingContractHash, reviewOperatingAction } from "@lervo/work-controller";
import { afterEach, describe, expect, it } from "vitest";
import { SupervisionDecisionJournal, SQLiteSupervisionOwnerLeaseStore } from "../src/index.js";
import { hash, mandate, now, plan, snapshot } from "./supervision.fixture.js";
import {
  readiness,
  responsibility,
} from "../../work-controller/test/operating-supervision.fixture.js";

const roots: string[] = [];
const stores: (SQLiteEventStore | SQLiteSupervisionOwnerLeaseStore)[] = [];
async function fixture(writer: 1 | 2 | 3 = 3) {
  const root = await mkdtemp(resolve(tmpdir(), "supervision-journal-"));
  roots.push(root);
  const path = resolve(root, "events.sqlite");
  const action = plan();
  const events = await SQLiteEventStore.open({
    path,
    projectId: action.projectId,
    writableEventSchemaVersion: writer,
  });
  stores.push(events);
  events.append({
    eventId: action.causationEventIds[0]!,
    projectId: action.projectId,
    runId: "run_fixture_cause",
    sessionId: "ses_fixture_cause",
    type: "run.requested",
    occurredAt: now,
    schemaVersion: 1,
    policyVersion: hash(),
    actor: { kind: "user" },
    payload: {},
  });
  const artifacts = await FileSystemCas.open(resolve(root, "cas"));
  const coordinates = {
    ...action,
    workstreamRevision: 1,
    sessionId: "ses_fixture_supervision",
    policyVersion: hash(),
  };
  const leaseStore = SQLiteSupervisionOwnerLeaseStore.open(resolve(root, "leases.sqlite"));
  stores.push(leaseStore);
  const lease = leaseStore.acquire({
    supervisionId: action.supervisionId,
    ownerAgentId: action.ownerAgentId,
    nowMs: Date.parse(now),
    durationMs: 300000,
  })!;
  const fence = { store: leaseStore, lease };
  const journal = new SupervisionDecisionJournal(events, artifacts, coordinates, () => now, fence);
  const review = reviewOperatingAction({ mandate: mandate(), plan: action, snapshot: snapshot() });
  return { path, events, artifacts, coordinates, action, journal, review, fence };
}
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("canonical readiness failure evidence", () => {
  function failure(reasonCodes = ["readiness_provider_failed"]) {
    const task = responsibility();
    const observation = readiness();
    observation.responsibilityArtifactHash = operatingContractHash(task);
    observation.checks.find((check) => check.kind === "provider")!.status = "failed";
    return { responsibility: task, observation, reasonCodes };
  }
  it("records one time-free failure per decision and exposes it without proving repair", async () => {
    const f = await fixture();
    const receipt = await f.journal.recordDecision(f.action, f.review);
    const first = await f.journal.recordReadinessFailure(receipt, failure());
    const later = failure();
    later.observation.observedAt = "2026-09-11T03:00:10.000Z";
    later.observation.validUntil = "2026-09-11T03:01:10.000Z";
    later.observation.checks.find((check) => check.kind === "budget")!.evidenceHash = hash("9");
    expect(await f.journal.recordReadinessFailure(receipt, later)).toBe(first);
    expect(
      f.events.list().filter((e) => e.type === "work.supervision.readiness.failed"),
    ).toHaveLength(1);
    const failures = f.journal.findReadinessFailures(receipt.decisionId);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      eventId: first,
      reasonCode: "readiness_provider_failed",
      executorAgentId: responsibility().executorAgentId,
    });
    const recorded = f.events.get(first)!;
    expect(recorded.payload).toMatchObject({
      decisionId: receipt.decisionId,
      planHash: receipt.planHash,
      assignmentId: responsibility().assignmentId,
      causationEventIds: [
        f.journal["journal"].eventId("work.supervision.decision.recorded", receipt.decisionId),
      ],
    });
    expect(JSON.stringify(recorded.payload)).not.toContain("observedAt");
    expect(f.journal.findDecision(receipt.decisionId)!.status).toBe("recorded");
    const changed = failure(["readiness_tools_failed", "readiness_provider_failed"]);
    changed.observation.checks.find((check) => check.kind === "tools")!.status = "failed";
    expect(await f.journal.recordReadinessFailure(receipt, changed)).not.toBe(first);
    expect(f.journal.findReadinessFailures(receipt.decisionId)).toHaveLength(2);
  });
  it("rejects unobserved readiness, unbound observations and executed decisions", async () => {
    const f = await fixture();
    const receipt = await f.journal.recordDecision(f.action, f.review);
    await expect(
      f.journal.recordReadinessFailure(receipt, failure(["readiness_provider_unobserved"])),
    ).rejects.toThrow(/not bound/u);
    const unobserved = failure();
    unobserved.observation.checks.find((check) => check.kind === "provider")!.status = "unobserved";
    await expect(f.journal.recordReadinessFailure(receipt, unobserved)).rejects.toThrow(
      /not bound/u,
    );
    const foreign = failure();
    foreign.observation.agentId = `agt_${"c".repeat(24)}`;
    await expect(f.journal.recordReadinessFailure(receipt, foreign)).rejects.toThrow(/not bound/u);
    await expect(
      f.journal.recordReadinessFailure({ ...receipt, decisionId: "dec_missing" }, failure()),
    ).rejects.toThrow(/not bound/u);
    f.journal.recordEffect({ ...receipt, status: "uncertain", effectEventIds: [] });
    await expect(f.journal.recordReadinessFailure(receipt, failure())).rejects.toThrow(
      /not bound/u,
    );
  });
});

describe("canonical preflight non-start evidence", () => {
  const inspection = {
    schemaVersion: 1 as const,
    kind: "work.supervision.preflight_inspection" as const,
    failurePhase: "readiness" as const,
    reasonCode: "supervision_readiness_stale",
    finalAdmission: {
      snapshotHash: hash("b"),
      observedAt: now,
      disposition: "admitted" as const,
    },
    finalReadiness: {
      observationHash: hash("c"),
      observedAt: now,
      validUntil: "2026-09-11T03:01:00.000Z",
      failedCheckKinds: [],
      unobservedCheckKinds: [],
    },
  };

  it("writes one bounded block and retains it across a recorded decision", async () => {
    const f = await fixture();
    const receipt = await f.journal.recordDecision(f.action, f.review);
    const first = await f.journal.recordPreflightBlocked(receipt, f.action, inspection);
    expect(await f.journal.recordPreflightBlocked(receipt, f.action, inspection)).toBe(first);
    expect(f.journal.findUnresolvedPreflightBlock()).toEqual({
      eventId: first,
      decisionId: receipt.decisionId,
      reasonCode: inspection.reasonCode,
    });
    const event = f.events.get(first)!;
    expect(event.payload).toMatchObject({
      planHash: receipt.planHash,
      failurePhase: "readiness",
      reasonCode: inspection.reasonCode,
    });
    expect(JSON.stringify(event.payload)).not.toContain("observedAt");
    f.journal.recordEffect({ ...receipt, status: "uncertain", effectEventIds: [] });
    expect(f.journal.findUnresolvedPreflightBlock()).not.toBeNull();
    await expect(f.journal.recordPreflightBlocked(receipt, f.action, inspection)).rejects.toThrow(
      /unexecuted/u,
    );
  });

  it("rejects malformed or foreign inspection metadata", async () => {
    const f = await fixture();
    const receipt = await f.journal.recordDecision(f.action, f.review);
    await expect(
      f.journal.recordPreflightBlocked(receipt, f.action, {
        ...inspection,
        finalReadiness: { ...inspection.finalReadiness, failedCheckKinds: ["raw/path"] },
      }),
    ).rejects.toThrow(/not bound/u);
    await expect(
      f.journal.recordPreflightBlocked(receipt, { ...f.action, effectHash: hash("f") }, inspection),
    ).rejects.toThrow(/not bound/u);
    expect(f.journal.findUnresolvedPreflightBlock()).toBeNull();
  });
});

describe("canonical supervision decision recovery", () => {
  it("retains reviewed bytes if the caller mutates its inputs while CAS persistence awaits", async () => {
    const f = await fixture();
    const original = structuredClone(f.action);
    const pending = f.journal.recordDecision(f.action, f.review);
    f.action.deadline = "invalid";
    f.review.planHash = hash("f");
    await pending;
    expect(await f.journal.findPendingPlan()).toEqual(original);
  });
  it("rejects evidence mutation by a released owner even when the plan remains valid", async () => {
    const f = await fixture();
    f.fence.store.release(f.fence.lease);
    await expect(f.journal.recordDecision(f.action, f.review)).rejects.toMatchObject({
      code: "lease_lost",
    });
    expect(f.events.latest()!.seq).toBe(1);
  });
  it("restores the exact plan and uncertain receipt on a separate connection and deduplicates replay", async () => {
    const f = await fixture();
    const receipt = await f.journal.recordDecision(f.action, f.review);
    f.journal.recordEffect({ ...receipt, status: "uncertain", effectEventIds: [] });
    const second = await SQLiteEventStore.open({
      path: f.path,
      projectId: f.action.projectId,
      writableEventSchemaVersion: 3,
    });
    stores.push(second);
    const recovered = new SupervisionDecisionJournal(
      second,
      f.artifacts,
      { ...f.coordinates, workstreamRevision: 2 },
      () => now,
      f.fence,
    );
    expect(await recovered.findPendingPlan()).toEqual(f.action);
    expect(recovered.findDecision(receipt.decisionId)?.status).toBe("uncertain");
    const count = f.events.latest()!.seq;
    await f.journal.recordDecision(f.action, f.review);
    f.journal.recordEffect({ ...receipt, status: "uncertain", effectEventIds: [] });
    expect(f.events.latest()!.seq).toBe(count);
    expect(f.events.verifyIntegrity().valid).toBe(true);
  });

  it.each([1, 2] as const)(
    "rejects a v3 decision under writer activation %i without appending evidence",
    async (version) => {
      const f = await fixture(version);
      await expect(f.journal.recordDecision(f.action, f.review)).rejects.toMatchObject({
        code: "event_schema_unsupported",
      });
      expect(f.events.latest()!.seq).toBe(1);
    },
  );

  it("requires later canonical effect evidence and never downgrades confirmation", async () => {
    const f = await fixture();
    const receipt = await f.journal.recordDecision(f.action, f.review);
    expect(() =>
      f.journal.recordEffect({
        ...receipt,
        status: "effect_confirmed",
        effectEventIds: f.action.causationEventIds,
      }),
    ).toThrow();
    const evidence = f.events.append({
      eventId: `evt_${"b".repeat(32)}`,
      projectId: f.action.projectId,
      runId: "run_fixture_effect",
      sessionId: "ses_fixture_effect",
      type: "run.requested",
      occurredAt: now,
      schemaVersion: 1,
      policyVersion: hash(),
      actor: { kind: "system" },
      payload: {},
    }).event;
    const confirmed = {
      ...receipt,
      status: "effect_confirmed" as const,
      effectEventIds: [evidence.eventId],
    };
    f.journal.recordEffect(confirmed);
    expect(await f.journal.findPendingPlan()).toBeNull();
    expect(() => f.journal.recordEffect({ ...receipt, status: "uncertain" })).toThrow();
  });

  it("rejects corrupted review binding and unavailable plan artifacts", async () => {
    const f = await fixture();
    await expect(
      f.journal.recordDecision(f.action, { ...f.review, reviewHash: hash() }),
    ).rejects.toThrow();
    await f.journal.recordDecision(f.action, f.review);
    const missing = new SupervisionDecisionJournal(
      f.events,
      {
        ...f.artifacts,
        get: async () => {
          throw new Error("artifact_unavailable");
        },
        put: f.artifacts.put.bind(f.artifacts),
        putStream: f.artifacts.putStream.bind(f.artifacts),
        has: f.artifacts.has.bind(f.artifacts),
      },
      f.coordinates,
      () => now,
      f.fence,
    );
    await expect(missing.findPendingPlan()).rejects.toThrow("artifact_unavailable");
  });
});
