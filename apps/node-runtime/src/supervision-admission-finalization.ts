import type { OperatingAdmissionSnapshotV1 } from "@lervo/application-contract";

type CurrentTaskSource = {
  responsibilities: readonly {
    assignmentId: string;
    binding: { responsibilityHash: string } | null;
  }[];
  assignments: readonly {
    assignmentId: string;
    lease: { expiresAt: string } | null;
  }[];
};

type CurrentAuthority = {
  installation: {
    latestEventId: string;
    mandateHash: string;
    installationReviewHash: string;
    revoked: boolean;
  };
  source: {
    sourceRevisionDigest: string;
    workstreamRevision: number;
    eligible: boolean;
  };
};

/** A final authority read cannot silently refresh a changed or revoked installation. */
export function assertSupervisionAdmissionAuthorityStable(
  before: CurrentAuthority,
  after: CurrentAuthority,
): void {
  if (
    after.installation.latestEventId !== before.installation.latestEventId ||
    after.installation.mandateHash !== before.installation.mandateHash ||
    after.installation.installationReviewHash !== before.installation.installationReviewHash ||
    after.installation.revoked !== before.installation.revoked ||
    after.source.sourceRevisionDigest !== before.source.sourceRevisionDigest ||
    after.source.workstreamRevision !== before.source.workstreamRevision ||
    after.source.eligible !== before.source.eligible
  )
    throw new Error("The supervision admission authority changed during observation.");
}

/** Dates a content-stable admission only after its final source recheck. */
export function finalizeSupervisionAdmission(input: {
  observation: OperatingAdmissionSnapshotV1;
  source: CurrentTaskSource;
  responsibilityArtifactHash: string;
  observedAt: string;
}): OperatingAdmissionSnapshotV1 {
  const responsibility = input.source.responsibilities.find(
    (item) => item.binding?.responsibilityHash === input.responsibilityArtifactHash,
  );
  const lease = input.source.assignments.find(
    (item) => item.assignmentId === responsibility?.assignmentId,
  )?.lease;
  return {
    ...input.observation,
    observedAt: input.observedAt,
    liveResponsibilityLease:
      input.observation.liveResponsibilityLease &&
      lease !== null &&
      lease !== undefined &&
      Date.parse(lease.expiresAt) > Date.parse(input.observedAt),
  };
}
