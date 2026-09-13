export const operatingActionKinds = [
  "allocate_existing",
  "execute_as_owner",
  "hire_worker",
  "revise_responsibility",
  "request_team_support",
  "dispatch",
  "inspect_uncertain_effect",
  "retry_attempt",
  "request_rework",
  "escalate",
  "publish_result",
] as const;

export type OperatingActionKind = (typeof operatingActionKinds)[number];

/** Exact reviewed authority; loading this value alone never admits an effect. */
export interface OperatingMandateV1 {
  schemaVersion: 1;
  mandateId: string;
  version: number;
  appointingAuthorityId: string;
  ownerAgentId: string;
  projectIds: string[];
  teamIds: string[];
  actionKinds: OperatingActionKind[];
  roleIds: string[];
  capabilityCeiling: string[];
  pathRoots: string[];
  providers: string[];
  maximumWorkers: number;
  maximumConcurrentAttempts: number;
  maximumAttemptsPerAssignment: number;
  maximumAttemptTokens: number;
  maximumAggregateTokens: number;
  maximumDeadlineMs: number;
  issuedAt: string;
  expiresAt: string;
  revocationCoordinate: string;
}

/** Reviewed single execution side; this designation does not assert cross-device convergence. */
export interface OperatingMandateV2 extends Omit<OperatingMandateV1, "schemaVersion"> {
  schemaVersion: 2;
  executionAuthority: {
    schemaVersion: 1;
    mode: "designated_host";
    hostIdentityHash: string;
  };
}

/** A reviewed goal boundary within a long-lived workstream; prior evidence remains canonical. */
export interface OperatingMandateV3 extends Omit<OperatingMandateV2, "schemaVersion"> {
  schemaVersion: 3;
  workScope: {
    schemaVersion: 1;
    workstreamId: string;
    snapshotEventId: string;
    snapshotEventHash: string;
    excludedAssignments: { assignmentId: string; contentHash: string }[];
  };
}

export type OperatingMandate = OperatingMandateV1 | OperatingMandateV2 | OperatingMandateV3;

export interface OperatingActionPlanV1 {
  schemaVersion: 1;
  supervisionId: string;
  projectId: string;
  teamId: string;
  workstreamId: string;
  ownerAgentId: string;
  mandateHash: string;
  sourceRevisionDigest: string;
  graphHash: string;
  causationEventIds: string[];
  actionKind: OperatingActionKind;
  effectContract: string;
  effectHash: string;
  rationaleArtifactHash: string;
  responsibilityArtifactHash: string;
  roleId: string;
  requiredCapabilities: string[];
  expectedPaths: string[];
  provider: string;
  addedWorkers: number;
  addedAssignments: number;
  concurrentAttempts: number;
  attemptNumber: number;
  reservedTokens: number;
  deadline: string;
}

/** Supplied by the authority adapter from verified, current canonical sources. */
export interface OperatingAdmissionSnapshotV1 {
  observedAt: string;
  sourceRevisionDigest: string;
  graphHash: string;
  installedMandateHash: string | null;
  installationReviewHash: string | null;
  revocationCoordinate: string;
  revoked: boolean;
  ancestryValid: boolean;
  historyValid: boolean;
  activeWorkers: number | null;
  activeAttempts: number | null;
  assignmentCount: number;
  observedAggregateTokens: number | null;
  reservedAggregateTokens: number | null;
  liveResponsibilityLease: boolean;
  resourceAdmission: "within" | "exhausted" | "unobserved";
  /** Adapter-derived scope and cost of the exact effect payload, never copied from model declarations. */
  effectAdmissionHash: string;
  effectMappings: { actionKind: OperatingActionKind; contract: string }[];
}

export interface OperatingPolicyReviewV1 {
  schemaVersion: 1;
  kind: "operating_policy.review";
  reviewMode: "mandate_policy_v1";
  reviewerPolicyId: "lervo.operating-mandate.v1";
  mandateHash: string;
  installationReviewHash: string | null;
  planHash: string;
  graphHash: string;
  sourceRevisionDigest: string;
  snapshotHash: string;
  decisionId: string;
  disposition: "admitted" | "blocked";
  reasonCodes: string[];
  reviewHash: string;
}
