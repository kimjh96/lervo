import type { KnowledgeConvergenceStage, KnowledgeConvergenceState } from "@lervo/schemas";

export const KNOWLEDGE_CONVERGENCE_DESTINATION = "knowledge:convergence";
export const MAXIMUM_CONVERGENCE_OBLIGATIONS = 1_024;

/** Private capture. Public events expose only its content hash and debt counts. */
export interface KnowledgeConvergenceBaseline {
  schemaVersion: 1;
  projectId: string;
  sourceSnapshotId: string;
  sourceSnapshotHash: string;
  sourceCommit?: string;
  policyHash: string;
  debtDigest: string;
  delegationHash: string | null;
  debtCounts: {
    canonicalization: number;
    normalization: number;
    lifecycle: number;
    historical: number;
  };
  sources: { path: string; contentHash: string; kind: "text" | "opaque" }[];
  /** Exact paths with an observed change, pending document, or unresolved source obligation. */
  assessmentPaths?: string[];
  /**
   * Obligation paths whose exact bytes are already settled: an integrated independent approval or
   * draft (`reference` is its integration event ID) or a reviewed normalization rewrite (`reference`
   * is its normalization record ID).
   */
  settledAssessments?: { path: string; contentHash: string; reference: string }[];
  /** Content hash of the owner decision that closed exact historical obligations, if any. */
  historyAcceptanceHash?: string | null;
  sourceDispositions?: {
    path: string;
    contentHash: string;
    kind: "semantic_source" | "policy_excluded" | "sensitive_local" | "opaque_verification";
    reason: string;
  }[];
  normalizationPaths: string[];
  historicalEvents: { eventId: string; eventHash: string; failureCode: string | null }[];
}

export interface KnowledgeConvergenceReceipt {
  stage: KnowledgeConvergenceStage;
  artifactHash: string;
  snapshotHash: string;
}

export interface KnowledgeConvergenceInput {
  schemaVersion: 1;
  obligationId: string;
  baseline: KnowledgeConvergenceBaseline;
  snapshotHash: string;
  receipts: KnowledgeConvergenceReceipt[];
  /** Stage-owned private data, validated by its adapter before use. */
  stageData: Record<string, unknown>;
}

export interface KnowledgeConvergenceStageResult {
  state: Exclude<KnowledgeConvergenceState, "queued" | "running" | "superseded">;
  input: KnowledgeConvergenceInput;
  assignmentId: string | null;
  leaseGeneration: string | null;
  failureCode: string | null;
  dependencyHash: string | null;
  /** A bounded batch may repeat its stage; normalization apply can request the next batch. */
  nextStage: KnowledgeConvergenceStage | null;
  knowledgeSnapshotHash?: string;
}

/** The owner controls handoff. Hosts implement source capture, governed effects, and verification. */
export interface KnowledgeConvergenceHost {
  discover(): Promise<KnowledgeConvergenceBaseline>;
  runStage(
    stage: KnowledgeConvergenceStage,
    input: KnowledgeConvergenceInput,
    assertLease: () => void,
  ): Promise<KnowledgeConvergenceStageResult>;
  /** Checks the exact private input after asynchronous work and immediately before settlement. */
  assertCurrent(input: KnowledgeConvergenceInput): Promise<void>;
  assertSettlement(input: KnowledgeConvergenceInput): void;
  /** A stopped dependency resumes only after its coordinate changes. */
  dependencyCurrent(hash: string): Promise<boolean>;
}

export interface KnowledgeConvergenceStatus {
  transport: "ready" | "reader_transition_required";
  debtCounts: KnowledgeConvergenceBaseline["debtCounts"] | null;
  outstanding: number;
  oldestAgeMilliseconds: number | null;
  activeStage: KnowledgeConvergenceStage | null;
  state: KnowledgeConvergenceState | "idle";
  reason: string | null;
  /** Present only for `recovery_required`: the owner command that resolves the blocked transaction. */
  recoveryCommand?: string;
  /**
   * Present only for `retry_scheduled`: attempts consumed, the logical budget for the failure
   * code (`null` for a code this version does not retry), and when the next attempt is due.
   */
  retry?: { attemptCount: number; attemptLimit: number | null; nextAttemptAt: string };
  /**
   * Present only for `knowledge_normalization_outside_delegation`: how many pending documents wait
   * and the repository-relative top-level roots that the delegation's normalization roots exclude.
   */
  scopeGap?: { pendingDocuments: number; outsideNormalizationRoots: string[] };
  lastVerifiedCurrency: { obligationId: string; snapshotHash: string; resolvedAt: string } | null;
}
