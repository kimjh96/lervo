export const stateRetentionClasses = [
  "replace_current",
  "rebuildable_cache",
  "pending_review",
  "completed_workspace",
  "bounded_observation",
  "recovery_required",
] as const;

export type StateRetentionClass = (typeof stateRetentionClasses)[number];
export type PrunableStateClass = Extract<
  StateRetentionClass,
  "rebuildable_cache" | "completed_workspace" | "bounded_observation"
>;

export interface StateRetentionLimit {
  maxAgeMs: number;
  maxCount: number;
  maxBytes: number;
}

export type StateRetentionPolicy = Record<PrunableStateClass, StateRetentionLimit>;

export const defaultStateRetentionPolicy: StateRetentionPolicy = {
  rebuildable_cache: {
    maxAgeMs: 14 * 24 * 60 * 60 * 1_000,
    maxCount: 128,
    maxBytes: 256 * 1024 * 1024,
  },
  completed_workspace: {
    maxAgeMs: 7 * 24 * 60 * 60 * 1_000,
    maxCount: 8,
    maxBytes: 128 * 1024 * 1024,
  },
  bounded_observation: {
    maxAgeMs: 30 * 24 * 60 * 60 * 1_000,
    maxCount: 32,
    maxBytes: 32 * 1024 * 1024,
  },
};

export interface StateRetentionEvidence {
  completedNormalizationCandidateIds: ReadonlySet<string>;
  completedCanonicalizationCandidateIds: ReadonlySet<string>;
  completedDeliberationIds: ReadonlySet<string>;
  activeDeliberationIds: ReadonlySet<string>;
}

export interface StatePruneOperation {
  operationId: string;
  relativePath: string;
  pathDigest: string;
  retentionClass: PrunableStateClass;
  reason: "age_limit" | "count_limit" | "byte_limit";
  fileCount: number;
  byteCount: number;
  contentDigest: string;
  modifiedAt: string;
}

export interface StateRetentionClassSummary {
  retentionClass: StateRetentionClass;
  artifactCount: number;
  fileCount: number;
  byteCount: number;
  reclaimableArtifactCount: number;
  reclaimableFileCount: number;
  reclaimableBytes: number;
}

export interface StatePrunePlan {
  schemaVersion: 1;
  planKind: "derived_state_prune";
  planId: string;
  repositoryRoot: string;
  status: "ready" | "current" | "blocked";
  policyHash: string;
  inventoryDigest: string;
  inspectedAt: string;
  durableDataPath: ".lervo/data";
  durableDataDisposition: "preserved";
  blockers: readonly string[];
  summaries: readonly StateRetentionClassSummary[];
  operations: readonly StatePruneOperation[];
}

export interface StatePrunePublicPlan extends Omit<StatePrunePlan, "operations"> {
  operations: ReadonlyArray<Omit<StatePruneOperation, "relativePath" | "contentDigest">>;
}

export interface StatePruneReceipt {
  schemaVersion: 1;
  receiptKind: "derived_state_prune_applied";
  planId: string;
  policyHash: string;
  inventoryDigest: string;
  removedFiles: number;
  removedBytes: number;
  removedByClass: Partial<
    Record<PrunableStateClass, { artifacts: number; files: number; bytes: number }>
  >;
  appliedAt: string;
  durableDataDisposition: "preserved";
}
