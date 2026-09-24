import type { InstalledOperatingMandate } from "@lervo/application-contract";
import { collectProjectEventsBounded, type EventStore } from "@lervo/storage-contract";
import { lineageRootId, operatingContractHash } from "@lervo/work-controller";
import type {
  SupervisionEventJournal,
  SupervisionJournalCoordinates,
} from "./supervision-event-journal.js";
import { listUnresolvedSupervisionPreflightBlocks } from "./supervision-preflight-block-journal.js";

const RESOLVED = "work.supervision.preflight.resolved";

export interface SupervisionPreflightAuthorityReviewV1 {
  schemaVersion: 1;
  kind: "work.supervision.preflight_resolution_review";
  resolutionKind: "reviewed_authority_change";
  blockedEventId: string;
  blockedEventHash: string;
  supersessionEventId: string;
  supersessionEventHash: string;
  sourceSnapshotEventId: string;
  sourceSnapshotEventHash: string;
  mandateHash: string;
  reviewerIdDigest: string;
}

/**
 * Binds one unresolved block to its exact non-start and to a later reviewed mandate whose owner
 * spend epoch starts after the block. Mandate renewal alone never qualifies: the reviewer must
 * approve this exact review, and an exhausted epoch cannot be reused.
 */
export function reviewSupervisionPreflightAuthorityChange(input: {
  events: EventStore;
  coordinates: Pick<SupervisionJournalCoordinates, "projectId" | "ownerAgentId" | "supervisionId">;
  installation: InstalledOperatingMandate;
  blockedEventId: string;
  reviewerId: string;
}): SupervisionPreflightAuthorityReviewV1 {
  const { events, coordinates, installation } = input;
  const blocked = listUnresolvedSupervisionPreflightBlocks({ events, coordinates }).find(
    (item) => item.eventId === input.blockedEventId,
  );
  if (blocked === undefined)
    throw new Error("The preflight block is absent or already resolved for this owner lineage.");
  const supersessions = collectProjectEventsBounded({ events, maximumEvents: 100_000 }).filter(
    (event) =>
      event.type === "work.supervision.decision.superseded" &&
      event.projectId === coordinates.projectId &&
      event.payload.decisionId === blocked.decisionId &&
      event.payload.planHash === blocked.planHash &&
      event.payload.supervisionId === blocked.supervisionId,
  );
  if (supersessions.length !== 1 || supersessions[0]!.seq <= blocked.seq)
    throw new Error("The blocked decision has no single exact non-start supersession.");
  const installed = events.get(installation.eventId);
  const mandate = installation.mandate;
  const allowance = mandate.schemaVersion === 3 ? mandate.ownerSpendAllowance : undefined;
  const anchor = allowance === undefined ? null : events.get(allowance.anchorEventId);
  if (
    installation.revoked ||
    installed === null ||
    installed.type !== "work.supervision.mandate.installed" ||
    installed.seq <= blocked.seq ||
    installed.payload.mandateHash !== installation.mandateHash ||
    lineageRootId(String(installed.payload.supervisionId)) !==
      lineageRootId(blocked.supervisionId) ||
    mandate.ownerAgentId !== coordinates.ownerAgentId ||
    mandate.appointingAuthorityId !== input.reviewerId ||
    anchor === null ||
    anchor.eventHash !== allowance!.anchorEventHash ||
    anchor.type !== "work.supervision.mandate.revoked" ||
    anchor.seq <= blocked.seq
  )
    throw new Error(
      "The resolution needs a current reviewed mandate whose owner spend epoch follows the block.",
    );
  return {
    schemaVersion: 1,
    kind: "work.supervision.preflight_resolution_review",
    resolutionKind: "reviewed_authority_change",
    blockedEventId: blocked.eventId,
    blockedEventHash: blocked.eventHash,
    supersessionEventId: supersessions[0]!.eventId,
    supersessionEventHash: supersessions[0]!.eventHash,
    sourceSnapshotEventId: installed.eventId,
    sourceSnapshotEventHash: installed.eventHash,
    mandateHash: installation.mandateHash,
    reviewerIdDigest: operatingContractHash({ reviewerId: input.reviewerId }),
  };
}

/** Appends the approved review only while the same block, non-start and installation are current. */
export async function recordSupervisionPreflightAuthorityResolution(input: {
  journal: SupervisionEventJournal;
  events: EventStore;
  coordinates: SupervisionJournalCoordinates;
  installation: InstalledOperatingMandate;
  blockedEventId: string;
  reviewerId: string;
  approval: string;
}): Promise<string> {
  const review = () => reviewSupervisionPreflightAuthorityChange(input);
  const expected = review();
  if (input.approval !== operatingContractHash(expected))
    throw new Error("The approval differs from the exact preflight resolution review.");
  const reviewArtifactHash = await input.journal.put(expected);
  const payload = {
    schemaVersion: 1,
    projectId: input.coordinates.projectId,
    workstreamId: input.coordinates.workstreamId,
    workstreamRevision: input.coordinates.workstreamRevision,
    supervisionId: input.coordinates.supervisionId,
    ownerAgentId: input.coordinates.ownerAgentId,
    mandateHash: input.installation.mandateHash,
    causationEventIds: [
      expected.blockedEventId,
      expected.supersessionEventId,
      expected.sourceSnapshotEventId,
    ],
    blockedEventId: expected.blockedEventId,
    blockedEventHash: expected.blockedEventHash,
    supersessionEventId: expected.supersessionEventId,
    supersessionEventHash: expected.supersessionEventHash,
    sourceSnapshotEventId: expected.sourceSnapshotEventId,
    sourceSnapshotEventHash: expected.sourceSnapshotEventHash,
    reviewArtifactHash,
    reviewerIdDigest: expected.reviewerIdDigest,
    resolutionKind: expected.resolutionKind,
  };
  const identity = operatingContractHash({
    blockedEventId: expected.blockedEventId,
    installationEventId: expected.sourceSnapshotEventId,
  });
  input.journal.append(RESOLVED, payload, identity, () => {
    const revoked = collectProjectEventsBounded({
      events: input.events,
      maximumEvents: 100_000,
    }).some(
      (event) =>
        event.type === "work.supervision.mandate.revoked" &&
        (event.payload.causationEventIds as unknown[]).includes(input.installation.eventId),
    );
    if (revoked || operatingContractHash(review()) !== input.approval)
      throw new Error("The preflight resolution source changed before it was recorded.");
  });
  return input.journal.eventId(RESOLVED, identity);
}
