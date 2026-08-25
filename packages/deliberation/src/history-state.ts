import type { DeliberationArtifact } from "@lervo/schemas";

export interface DeliberationHistoryAnalysis {
  deliberationId: string;
  lastRound: number;
  artifactIds: string[];
  lastArtifactId: string | null;
  openBlockingObjectionIds: string[];
  passedVerificationArtifactIds: string[];
  passedVerificationSuiteIds: Set<string>;
  passedClaimIdsBySuite: Map<string, Set<string>>;
  independentReviewApproved: boolean;
  decision: Extract<DeliberationArtifact, { kind: "decision" }> | null;
}

export interface DeliberationHistoryState {
  artifactsById: Map<string, DeliberationArtifact>;
  claims: Map<string, string>;
  objections: Map<
    string,
    {
      blocking: boolean;
      resolved: boolean;
      targetClaimIds: readonly string[];
    }
  >;
  runRoles: Map<string, string>;
  sessionRoles: Map<string, string>;
  receiptSessions: Map<string, string>;
  passedVerificationArtifactIds: string[];
  passedVerificationSuiteIds: Set<string>;
  passedClaimIdsBySuite: Map<string, Set<string>>;
  previousRound: number;
  previousTime: number;
  lastProposalOrRevisionIndex: number;
  lastProposalOrRevisionArtifactId: string | null;
  lastProposalOrRevisionRoleId: string | null;
  lastApprovedReviewIndex: number;
  deliberationId: string | null;
  decision: Extract<DeliberationArtifact, { kind: "decision" }> | null;
}

export function createDeliberationHistoryState(): DeliberationHistoryState {
  return {
    artifactsById: new Map(),
    claims: new Map(),
    objections: new Map(),
    runRoles: new Map(),
    sessionRoles: new Map(),
    receiptSessions: new Map(),
    passedVerificationArtifactIds: [],
    passedVerificationSuiteIds: new Set(),
    passedClaimIdsBySuite: new Map(),
    previousRound: 0,
    previousTime: Number.NEGATIVE_INFINITY,
    lastProposalOrRevisionIndex: -1,
    lastProposalOrRevisionArtifactId: null,
    lastProposalOrRevisionRoleId: null,
    lastApprovedReviewIndex: -1,
    deliberationId: null,
    decision: null,
  };
}
