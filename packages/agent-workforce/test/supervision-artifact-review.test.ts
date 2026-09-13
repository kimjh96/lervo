import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { FileSystemCas } from "@lervo/cas";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { canonicalJson } from "@lervo/event-contract";
import type {
  SupervisedArtifactReviewV1,
  SupervisedAssignmentObservationV1,
} from "@lervo/application-contract";
import {
  operatingContractHash,
  operatingEffectAdmissionHash,
  reviewOperatingAction,
} from "@lervo/work-controller";
import { afterEach, expect, it } from "vitest";
import {
  SupervisionArtifactReviewJournal,
  SupervisionDecisionJournal,
  SQLiteSupervisionOwnerLeaseStore,
} from "../src/index.js";
import { hash, mandate, now, plan, snapshot } from "./supervision.fixture.js";

const roots: string[] = [];
const stores: (SQLiteEventStore | SQLiteSupervisionOwnerLeaseStore)[] = [];
afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "owner-review-"));
  roots.push(root);
  const path = resolve(root, "events.sqlite");
  const action = plan();
  const authority = mandate();
  authority.actionKinds.push("execute_as_owner");
  action.mandateHash = operatingContractHash(authority);
  const events = await SQLiteEventStore.open({
    path,
    projectId: action.projectId,
    writableEventSchemaVersion: 3,
  });
  stores.push(events);
  const artifacts = await FileSystemCas.open(resolve(root, "cas"));
  const rationale = await artifacts.put(
    canonicalJson("The returned artifact meets the assignment's acceptance criteria."),
  );
  const terminalEventId = action.causationEventIds[0]!;
  events.append({
    eventId: terminalEventId,
    projectId: action.projectId,
    runId: "run_returned",
    sessionId: "ses_returned",
    type: "run.completed",
    schemaVersion: 3,
    occurredAt: now,
    actor: { kind: "system" },
    policyVersion: hash(),
    payload: {
      resultDigest: hash("c"),
      artifactIds: [`art_${"c".repeat(64)}`, `art_${"d".repeat(64)}`],
      verificationStatus: "passed",
    },
  });
  const effect: SupervisedArtifactReviewV1 = {
    schemaVersion: 1,
    kind: "work.artifact_review",
    assignmentId: `asn_${"b".repeat(24)}`,
    assignmentRevision: 3,
    responsibilityArtifactHash: action.responsibilityArtifactHash,
    terminalEventId,
    reviewerAgentId: action.ownerAgentId,
    acceptanceHash: hash("b"),
    artifactHashes: [hash("c")],
    verificationEventIds: [`evt_${"c".repeat(32)}`],
    verdict: "accepted",
    rationaleArtifactHash: rationale.contentHash,
  };
  Object.assign(action, {
    actionKind: "execute_as_owner",
    effectContract: "work.artifact_review.v1",
    effectHash: operatingContractHash(effect),
    rationaleArtifactHash: rationale.contentHash,
  });
  const observation = {
    ...snapshot(),
    installedMandateHash: action.mandateHash,
    effectAdmissionHash: operatingEffectAdmissionHash(action),
    effectMappings: [{ actionKind: action.actionKind, contract: action.effectContract }],
  };
  const review = reviewOperatingAction({ mandate: authority, plan: action, snapshot: observation });
  expect(review.disposition).toBe("admitted");
  const coordinates = {
    ...action,
    workstreamRevision: 1,
    sessionId: "ses_owner_review",
    policyVersion: hash(),
  };
  const leases = SQLiteSupervisionOwnerLeaseStore.open(resolve(root, "leases.sqlite"));
  stores.push(leases);
  const lease = leases.acquire({
    supervisionId: action.supervisionId,
    ownerAgentId: action.ownerAgentId,
    nowMs: Date.parse(now),
    durationMs: 300000,
  })!;
  const fence = { store: leases, lease };
  const decisions = new SupervisionDecisionJournal(
    events,
    artifacts,
    coordinates,
    () => now,
    fence,
  );
  const journal = new SupervisionArtifactReviewJournal(
    events,
    artifacts,
    coordinates,
    () => now,
    fence,
  );
  const receipt = await decisions.recordDecision(action, review);
  const assignment: SupervisedAssignmentObservationV1 = {
    assignmentId: effect.assignmentId,
    revision: effect.assignmentRevision,
    executorAgentId: `agt_${"b".repeat(24)}`,
    acceptanceOwnerAgentId: action.ownerAgentId,
    responsibilityArtifactHash: effect.responsibilityArtifactHash,
    status: "completed",
    dispatchedAt: now,
    startedAt: now,
    startDeadline: action.deadline,
    progressDeadline: action.deadline,
    completionDeadline: action.deadline,
    terminalEventId,
    effectDisposition: "reconciled",
    recoveryDecisionCount: 0,
    artifactHashes: effect.artifactHashes,
    requiredVerificationSuiteIds: ["result.check"],
    verification: [
      {
        suiteId: "result.check",
        eventId: effect.verificationEventIds[0]!,
        artifactHashes: effect.artifactHashes,
        status: "passed",
      },
    ],
    review: null,
    acceptanceHash: effect.acceptanceHash,
  };
  const record = (basis = assignment, validateCurrent = () => undefined) =>
    journal.record({ plan: action, effect, assignment: basis, validateCurrent });
  return {
    root,
    path,
    events,
    artifacts,
    coordinates,
    action,
    effect,
    assignment,
    receipt,
    journal,
    decisions,
    fence,
    record,
  };
}

it("persists one exact owner verdict, confirms its receipt and recovers on another connection", async () => {
  const f = await fixture();
  expect(await f.journal.inspect(f.action, f.effect)).toEqual({ status: "not_started" });
  const result = await f.record();
  f.decisions.recordEffect({
    ...f.receipt,
    status: "effect_confirmed",
    effectEventIds: result.eventIds,
  });
  expect(await f.decisions.findPendingPlan()).toBeNull();
  const count = f.events.latest()!.seq;
  expect(await f.record()).toEqual(result);
  expect(f.events.latest()!.seq).toBe(count);
  const connection = await SQLiteEventStore.open({
    path: f.path,
    projectId: f.action.projectId,
    writableEventSchemaVersion: 3,
  });
  stores.push(connection);
  const recovered = new SupervisionArtifactReviewJournal(
    connection,
    f.artifacts,
    f.coordinates,
    () => now,
    null,
  );
  expect(await recovered.inspect(f.action, f.effect)).toEqual({
    status: "confirmed",
    eventIds: result.eventIds,
  });
  expect(f.events.get(result.eventIds[0]!)!.payload).not.toHaveProperty("rationale");
  expect(f.events.verifyIntegrity().valid).toBe(true);
});

it.each(["revision", "result", "verification", "owner", "uncertain", "incomplete"])(
  "rejects %s drift without creating a review",
  async (change) => {
    const f = await fixture();
    const basis = structuredClone(f.assignment);
    if (change === "revision") basis.revision++;
    if (change === "result") basis.artifactHashes = [hash("f")];
    if (change === "verification") basis.verification[0]!.status = "failed";
    if (change === "owner") basis.acceptanceOwnerAgentId = basis.executorAgentId;
    if (change === "uncertain") basis.effectDisposition = "uncertain";
    if (change === "incomplete") basis.status = "leased";
    await expect(f.record(basis)).rejects.toThrow("task evidence");
    expect(await f.journal.inspect(f.action, f.effect)).toEqual({ status: "not_started" });
  },
);

it("fences an authority change during artifact I/O and a released owner", async () => {
  const f = await fixture();
  await expect(
    f.record(f.assignment, () => {
      throw new Error("source_changed");
    }),
  ).rejects.toThrow("source_changed");
  expect(await f.journal.inspect(f.action, f.effect)).toEqual({ status: "not_started" });
  f.fence.store.release(f.fence.lease);
  await expect(f.record()).rejects.toMatchObject({ code: "lease_lost" });
});

it("cannot substitute a different verdict or confirm the decision itself", async () => {
  const f = await fixture();
  await expect(
    f.journal.record({
      plan: f.action,
      effect: { ...f.effect, verdict: "rework" },
      assignment: f.assignment,
      validateCurrent: () => undefined,
    }),
  ).rejects.toThrow("exact decision");
  const decision = f.events
    .list({ limit: 20 })
    .find((event) => event.type === "work.supervision.decision.recorded")!;
  expect(() =>
    f.decisions.recordEffect({
      ...f.receipt,
      status: "effect_confirmed",
      effectEventIds: [decision.eventId],
    }),
  ).toThrow();
});
