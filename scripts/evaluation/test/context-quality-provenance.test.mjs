import { expect, it } from "vitest";
import { digest } from "../lib/context-quality-artifact-identity.mjs";
import {
  auditHistoricalProvenance,
  validateProvenanceProtocol,
} from "../lib/context-quality-provenance.mjs";

function fixture() {
  const query = "owner private original request";
  const snapshot = {
    workstreamId: `wks_${"a".repeat(24)}`,
    revision: 3,
    status: "active",
    objective: "private context",
    pendingApprovals: [{ approvalId: "approval", bindingHash: digest("review") }],
  };
  const bytes = Buffer.from(JSON.stringify(snapshot)),
    hash = digest(bytes);
  const events = [
    {
      seq: 1,
      eventId: `evt_${"a".repeat(32)}`,
      eventHash: digest("event"),
      type: "workstream.snapshot.recorded",
      payload: {
        workstreamId: snapshot.workstreamId,
        revision: 3,
        status: "active",
        snapshotContentHash: hash,
        snapshotArtifactId: `art_${hash.slice(7)}`,
      },
    },
  ];
  const artifacts = new Map([[hash, bytes]]);
  const storage = {
    events: {
      latest: () => events.at(-1),
      list: ({ afterSeq, limit, types }) =>
        events.filter((e) => e.seq > afterSeq && types.includes(e.type)).slice(0, limit),
      get: (id) => events.find((e) => e.eventId === id) ?? null,
      verifyIntegrity: () => ({ valid: true }),
    },
    artifacts: {
      has: async (uri) => artifacts.has(`sha256:${uri.split("/").at(-1)}`),
      get: async (uri) => artifacts.get(`sha256:${uri.split("/").at(-1)}`),
    },
  };
  const suite = {
    review: snapshot.pendingApprovals[0],
    cases: [{ caseId: "real", query, contextRequirement: "current_workstream" }],
  };
  const protocol = {
    schemaVersion: 1,
    auditId: "context-quality-historical-provenance-v1",
    maximumEvents: 100000,
    workstreamId: snapshot.workstreamId,
    snapshotCandidates: [
      { eventId: events[0].eventId, revision: 3, snapshotHash: hash, role: "candidate" },
    ],
    historicalReports: ["codex", "claude"].map((provider) => ({
      provider,
      reportId: provider,
      contentHash: digest(provider),
    })),
  };
  const run = () =>
    auditHistoricalProvenance(storage, suite, protocol, (x) => x.status === "active");
  return { query, snapshot, hash, artifacts, events, storage, suite, protocol, run };
}
it("recovers event-bound history without calling an inferred candidate the original context", async () => {
  const f = fixture();
  const r = await f.run();
  expect(r.candidates[0]).toMatchObject({
    presentAndBound: true,
    pendingReviewBinding: true,
    exactMeasurementContext: false,
  });
  expect(r.cases[0].originalContext).toBe("exact_binding_unavailable");
  expect(r.historicalReports.every((p) => !p.presentAtDeclaredCasHash)).toBe(true);
  expect(r.qualityQualified).toBe(false);
  expect(JSON.stringify(r)).not.toContain(f.query);
  expect(JSON.stringify(r)).not.toContain(f.snapshot.objective);
});
it("requires request digest, snapshot event, revision and body to bind an original request", async () => {
  const f = fixture();
  f.events.push({
    seq: 2,
    eventId: "context_event",
    eventHash: digest("context"),
    type: "terminal.context.prepared",
    payload: {
      requestDigest: digest(f.query),
      workstreamSnapshotHash: f.hash,
      workstreamId: f.snapshot.workstreamId,
      workstreamRevision: 3,
      sourceSnapshotId: "snapshot",
    },
  });
  expect((await f.run()).cases[0].originalContext).toBe("request_bound_snapshot_available");
  f.events[1].payload.workstreamRevision = 4;
  expect((await f.run()).cases[0].originalContext).toBe("exact_binding_unavailable");
});
it("rejects mutated CAS contents, invalid snapshots and mismatched candidate events", async () => {
  const f = fixture();
  f.artifacts.set(f.hash, Buffer.from("changed"));
  await expect(f.run()).rejects.toThrow("identity mismatch");
  const invalid = fixture();
  await expect(
    auditHistoricalProvenance(invalid.storage, invalid.suite, invalid.protocol, () => false),
  ).rejects.toThrow("canonical event");
  const mismatched = fixture();
  mismatched.events[0].payload.revision = 4;
  await expect(mismatched.run()).rejects.toThrow("canonical event");
});
it("retains a named original event when a later import binds the same snapshot", async () => {
  const f = fixture();
  f.events.push({ ...f.events[0], seq: 2, eventId: `evt_${"b".repeat(32)}` });
  expect((await f.run()).candidates[0].presentAndBound).toBe(true);
});
it("does not classify a retained request hash as a reviewed or held-out family", async () => {
  const f = fixture();
  const body = Buffer.from(f.query),
    hash = digest(body);
  f.artifacts.set(hash, body);
  f.events.push({ seq: 2, type: "run.requested", payload: { requestDigest: hash } });
  const r = await f.run();
  expect(r.scan.bodiesAtRequestHash).toBe(1);
  expect(r.cases[0]).toMatchObject({ newHeldOutEligible: false, fullAdr0501HumanLabels: false });
});
it("rejects malformed bounds and does not silently call a capped scan complete", async () => {
  const f = fixture();
  expect(() => validateProvenanceProtocol({ ...f.protocol, maximumEvents: 10 })).toThrow();
  f.storage.events.latest = () => ({ seq: 100001 });
  f.storage.events.list = ({ afterSeq, limit }) =>
    Array.from({ length: limit }, (_, i) => ({
      seq: afterSeq + i + 1,
      type: "run.requested",
      payload: {},
    }));
  const r = await f.run();
  expect(r.complete).toBe(false);
  expect(r.scan.scannedEvents).toBe(100000);
});
it("rejects a retained report whose declared provider or review binding differs", async () => {
  const f = fixture();
  const bytes = Buffer.from(
    JSON.stringify({
      reportId: "codex",
      provider: "claude",
      suiteBindingHash: f.suite.review.bindingHash,
    }),
  );
  const hash = digest(bytes);
  f.artifacts.set(hash, bytes);
  f.protocol.historicalReports[0].contentHash = hash;
  await expect(f.run()).rejects.toThrow("report binding mismatch");
});

it("reports excessive matching requests explicitly without emitting an unbounded detail array", async () => {
  const f = fixture();
  for (let i = 0; i < 33; i++)
    f.events.push({
      seq: i + 2,
      type: "terminal.context.prepared",
      payload: { requestDigest: digest(f.query) },
    });
  const r = await f.run();
  expect(r.complete).toBe(false);
  expect(r.cases[0]).toMatchObject({
    matchingTerminalEventCount: 33,
    matchingTerminalEvents: [],
    originalContext: "matching_event_bound_exceeded",
  });
});
