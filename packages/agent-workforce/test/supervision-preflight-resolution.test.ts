import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { OperatingMandateV3 } from "@lervo/application-contract";
import { FileSystemCas } from "@lervo/cas";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import {
  operatingContractHash,
  planMandateInstallation,
  reviewOperatingAction,
} from "@lervo/work-controller";
import { afterEach, expect, it, vi } from "vitest";
import { rejectWholeHistoryReads } from "../../storage-contract/test/whole-history-reads.fixture.js";
import {
  SupervisionDecisionJournal,
  SupervisionMandateJournal,
  SQLiteSupervisionOwnerLeaseStore,
} from "../src/index.js";
import { SupervisionEventJournal } from "../src/supervision-event-journal.js";
import { hash, mandate, now, plan, snapshot } from "./supervision.fixture.js";

const roots: string[] = [];
const stores: (SQLiteEventStore | SQLiteSupervisionOwnerLeaseStore)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const inspection = {
  schemaVersion: 1 as const,
  kind: "work.supervision.preflight_inspection" as const,
  failurePhase: "authority" as const,
  reasonCode: "supervision_owner_spend_exceeded",
  finalAdmission: null,
  finalReadiness: null,
};

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "preflight-resolution-"));
  roots.push(root);
  const action = plan();
  const events = await SQLiteEventStore.open({
    path: resolve(root, "events.sqlite"),
    projectId: action.projectId,
    writableEventSchemaVersion: 3,
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
  const leases = SQLiteSupervisionOwnerLeaseStore.open(resolve(root, "leases.sqlite"));
  stores.push(leases);
  const lease = leases.acquire({
    supervisionId: action.supervisionId,
    ownerAgentId: action.ownerAgentId,
    nowMs: Date.parse(now),
    durationMs: 300000,
  })!;
  const fence = { store: leases, lease };
  const coordinates = {
    ...action,
    workstreamRevision: 1,
    sessionId: "ses_fixture_supervision",
    policyVersion: hash(),
  };
  const mandates = new SupervisionMandateJournal(events, artifacts, coordinates, () => now, fence);
  const source = {
    projectId: action.projectId,
    teamId: action.teamId,
    workstreamId: action.workstreamId,
    workstreamRevision: 1,
    sourceRevisionDigest: hash(),
    causationEventIds: action.causationEventIds,
    ownerAgentId: action.ownerAgentId,
    eligible: true,
    reasonCodes: [],
  };
  const reviewerId = mandate().appointingAuthorityId;
  const first = planMandateInstallation({
    supervisionId: action.supervisionId,
    mandate: mandate(),
    source,
    previous: null,
    reviewerId,
    now,
  });
  const installed = await mandates.install(first, first.approvalHash, async () => undefined);
  const decisions = new SupervisionDecisionJournal(
    events,
    artifacts,
    { ...coordinates, mandateHash: installed.mandateHash },
    () => now,
    fence,
  );
  const review = reviewOperatingAction({ mandate: mandate(), plan: action, snapshot: snapshot() });
  const receipt = await decisions.recordDecision(action, review);
  const blockedEventId = await decisions.recordPreflightBlocked(receipt, action, inspection);
  const supersede = () =>
    new SupervisionEventJournal(events, artifacts, coordinates, () => now, fence).append(
      "work.supervision.decision.superseded",
      {
        schemaVersion: 1,
        projectId: action.projectId,
        workstreamId: action.workstreamId,
        workstreamRevision: 1,
        supervisionId: action.supervisionId,
        ownerAgentId: action.ownerAgentId,
        mandateHash: action.mandateHash,
        causationEventIds: (
          events.get(blockedEventId)!.payload.causationEventIds as string[]
        ).slice(0, 1),
        decisionId: receipt.decisionId,
        planHash: receipt.planHash,
        inspectionArtifactHash: hash("d"),
        sourceRevisionDigest: hash("e"),
      },
      receipt.decisionId,
    );
  const renew = async (anchorEventId: string) => {
    const anchor = events.get(anchorEventId)!;
    const next: OperatingMandateV3 = {
      ...mandate(),
      schemaVersion: 3,
      version: 2,
      executionAuthority: { schemaVersion: 1, mode: "designated_host", hostIdentityHash: hash() },
      workScope: {
        schemaVersion: 1,
        workstreamId: action.workstreamId,
        snapshotEventId: action.causationEventIds[0]!,
        snapshotEventHash: events.get(action.causationEventIds[0]!)!.eventHash,
        excludedAssignments: [],
      },
      ownerSpendAllowance: {
        schemaVersion: 1,
        mode: "incremental_reservation",
        projectId: action.projectId,
        anchorEventId: anchor.eventId,
        anchorEventHash: anchor.eventHash,
        maximumReservedTokens: 200_000,
      },
    } as OperatingMandateV3;
    const planned = planMandateInstallation({
      supervisionId: action.supervisionId,
      mandate: next,
      source,
      previous: (await mandates.current())!,
      reviewerId,
      now,
    });
    return mandates.install(planned, planned.approvalHash, async () => undefined);
  };
  return {
    events,
    mandates,
    decisions,
    installed,
    blockedEventId,
    supersede,
    renew,
    reviewerId,
    cause: action.causationEventIds[0]!,
  };
}

it("clears a block only through an approved review after non-start and a fresh spend epoch", async () => {
  const f = await fixture();
  // Every check reads only the event types it decides on, so history length cannot fail it.
  rejectWholeHistoryReads(f.events);
  // Without a proven non-start or a later reviewed epoch nothing can be reviewed.
  await expect(
    f.mandates.reviewPreflightResolution(f.blockedEventId, f.reviewerId),
  ).rejects.toThrow(/non-start/u);
  f.supersede();
  await expect(
    f.mandates.reviewPreflightResolution(f.blockedEventId, f.reviewerId),
  ).rejects.toThrow(/spend epoch/u);
  const revoked = await f.mandates.revoke({
    mandateHash: f.installed.mandateHash,
    installationEventId: f.installed.eventId,
    reviewerId: f.reviewerId,
  });
  await f.renew(revoked.latestEventId);
  expect(f.decisions.findUnresolvedPreflightBlock()?.eventId).toBe(f.blockedEventId);
  await expect(
    f.mandates.reviewPreflightResolution(f.blockedEventId, "user.other"),
  ).rejects.toThrow(/spend epoch/u);
  const review = await f.mandates.reviewPreflightResolution(f.blockedEventId, f.reviewerId);
  await expect(
    f.mandates.resolvePreflight(f.blockedEventId, f.reviewerId, hash("f")),
  ).rejects.toThrow(/approval/u);
  // Renewal alone changed nothing; only the approved review clears the barrier.
  expect(f.decisions.findUnresolvedPreflightBlock()).not.toBeNull();
  const resolved = await f.mandates.resolvePreflight(
    f.blockedEventId,
    f.reviewerId,
    operatingContractHash(review),
  );
  expect(f.events.get(resolved)!.payload).toMatchObject({
    resolutionKind: "reviewed_authority_change",
    causationEventIds: [
      review.blockedEventId,
      review.supersessionEventId,
      review.sourceSnapshotEventId,
    ],
  });
  expect(f.decisions.findUnresolvedPreflightBlock()).toBeNull();
  await expect(
    f.mandates.reviewPreflightResolution(f.blockedEventId, f.reviewerId),
  ).rejects.toThrow(/already resolved/u);
  expect(f.events.verifyIntegrity().valid).toBe(true);
});

it("refuses an epoch anchored before the block", async () => {
  const f = await fixture();
  f.supersede();
  await f.mandates.revoke({
    mandateHash: f.installed.mandateHash,
    installationEventId: f.installed.eventId,
    reviewerId: f.reviewerId,
  });
  // An allowance anchored before the block (here the goal's cause) would reuse the exhausted epoch.
  await f.renew(f.cause);
  await expect(
    f.mandates.reviewPreflightResolution(f.blockedEventId, f.reviewerId),
  ).rejects.toThrow(/spend epoch/u);
});
