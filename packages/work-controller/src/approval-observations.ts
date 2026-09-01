import type { ApprovalObservationV1, WorkGraphV1 } from "@lervo/application-contract";

const ASSIGNMENT_ID = /^asn_[a-f0-9]{24}$/u;
const APPROVAL_ID = /^apr_[A-Za-z0-9_-]{8,128}$/u;
const AUTHORITY_ID = /^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/u;
const HASH = /^sha256:[a-f0-9]{64}$/u;
const REASON_CODE = /^[a-z][a-z0-9_]{1,99}$/u;

export interface ApprovalObservationIndex {
  valid: boolean;
  ordered: ApprovalObservationV1[];
  byCoordinate: ReadonlyMap<string, ApprovalObservationV1>;
}

export function approvalCoordinate(assignmentId: string, requirementDigest: string): string {
  return `${assignmentId}\0${requirementDigest}`;
}

export function indexApprovalObservations(input: {
  graph: WorkGraphV1;
  observations: readonly ApprovalObservationV1[];
}): ApprovalObservationIndex {
  const observedAtMs = Date.parse(input.graph.observedAt);
  const expected = new Set(
    input.graph.nodes.flatMap((node) =>
      node.approvalRequirementDigests.map((requirementDigest) =>
        approvalCoordinate(node.assignmentId, requirementDigest),
      ),
    ),
  );
  const revisionByAssignment = new Map(
    input.graph.nodes.map((node) => [node.assignmentId, node.assignmentRevision]),
  );
  const ordered = [...input.observations].sort((left, right) =>
    approvalCoordinate(left.assignmentId, left.requirementDigest).localeCompare(
      approvalCoordinate(right.assignmentId, right.requirementDigest),
    ),
  );
  const coordinates = ordered.map((observation) =>
    approvalCoordinate(observation.assignmentId, observation.requirementDigest),
  );
  const valid =
    Number.isFinite(observedAtMs) &&
    new Set(coordinates).size === coordinates.length &&
    ordered.every((observation, index) => {
      if (
        observation.schemaVersion !== 1 ||
        !ASSIGNMENT_ID.test(observation.assignmentId) ||
        observation.assignmentRevision !== revisionByAssignment.get(observation.assignmentId) ||
        !HASH.test(observation.requirementDigest) ||
        !expected.has(coordinates[index]!)
      ) {
        return false;
      }
      if (observation.status !== "verified") return REASON_CODE.test(observation.reasonCode);
      const grantedAtMs = Date.parse(observation.grantedAt);
      const expiresAtMs = Date.parse(observation.expiresAt);
      return (
        APPROVAL_ID.test(observation.approvalId) &&
        observation.authorityId.length <= 200 &&
        AUTHORITY_ID.test(observation.authorityId) &&
        HASH.test(observation.authorityEvidenceHash) &&
        Number.isFinite(grantedAtMs) &&
        Number.isFinite(expiresAtMs) &&
        grantedAtMs <= observedAtMs &&
        observedAtMs < expiresAtMs &&
        grantedAtMs < expiresAtMs
      );
    });
  return {
    valid,
    ordered,
    byCoordinate: new Map(ordered.map((item, index) => [coordinates[index]!, item])),
  };
}
