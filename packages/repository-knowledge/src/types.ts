export type RepositorySourceKind =
  | "code"
  | "documentation"
  | "instruction"
  | "configuration"
  | "schema"
  | "test"
  | "build_definition"
  | "skill_contract"
  | "agent_workflow"
  | "agent_definition"
  | "execution_policy"
  | "agent_configuration"
  | "revision_metadata"
  | "verification_result"
  | "execution_event"
  | "log"
  | "other";
export type SourceInventoryStatus = "included" | "excluded" | "unsupported";
export type SourceClassification = "ordinary" | "sensitive" | "secret_candidate" | "unsupported";
export type SourceUnitKind =
  | "file"
  | "markdown_section"
  | "code_symbol"
  | "config_key"
  | "revision"
  | "verification"
  | "event"
  | "skill_contract";

export interface RepositoryAgentArtifact {
  profileId: string;
  profileVersion: 1;
  provider: "shared" | "codex" | "claude" | "copilot" | "unknown";
  role:
    | "behavioral_instruction"
    | "skill"
    | "skill_resource"
    | "legacy_command"
    | "agent_definition"
    | "execution_policy"
    | "lifecycle_hook"
    | "client_configuration"
    | "tool_configuration"
    | "unknown";
  scope: "repository" | "subtree" | "local_repository";
  discovery:
    | "automatic"
    | "automatic_or_path_conditional"
    | "conditional"
    | "on_demand"
    | "explicit"
    | "client_enforced"
    | "trusted_project_only"
    | "approval_required"
    | "not_current_standard"
    | "not_standard";
  migrationDisposition:
    | "canonical"
    | "scoped_canonical"
    | "provider_bridge"
    | "portable_skill"
    | "portable_skill_resource"
    | "portable_skill_review"
    | "workflow_review"
    | "provider_specific_review"
    | "provider_specific_preserve"
    | "execution_policy_preserve"
    | "local_preserve"
    | "nonstandard_preserve";
  contentHandling: "semantic_source" | "local_inventory_only";
}

export interface RepositoryKnowledgePolicy {
  schemaVersion: 1;
  policyId: string;
  publicationRoot: string;
  publication: {
    /** BCP 47 language tag. The v1 renderer currently supports `en`. */
    language: import("./publication-language.js").RepositoryPublicationLanguage;
    maxNavigationEntries: number;
    maxNavigationBytes: number;
  };
  normalization?: { exclude: string[] };
  exclude: string[];
  limits: {
    maxFiles: number;
    maxFileBytes: number;
    maxTotalBytes: number;
  };
}

export interface RepositorySource {
  sourceId: string;
  path: string;
  identityPath?: string;
  kind: RepositorySourceKind;
  status: SourceInventoryStatus;
  classification: SourceClassification;
  byteCount: number;
  contentHash: string | null;
  reason?: string;
  content?: string;
  origin?: "git_revision_adapter" | "verification_event_cas" | "execution_event_store";
  agentArtifact?: RepositoryAgentArtifact;
}

export interface RepositorySupplementalSource {
  path: string;
  kind: "verification_result" | "execution_event";
  classification: "ordinary" | "sensitive";
  content: string;
  origin: "verification_event_cas" | "execution_event_store";
  unitKind: "verification" | "event";
  locator: string;
  title: string;
  adapter: string;
}

export interface RepositoryKnowledgeScanOptions {
  supplementalSources?: readonly RepositorySupplementalSource[];
}

export interface RepositorySourceUnit {
  unitId: string;
  unitVersionId: string;
  sourceId: string;
  sourceHash: string;
  unitHash: string;
  unitKind: SourceUnitKind;
  path: string;
  locator: string;
  range: { startByte: number; endByte: number; startLine: number; endLine: number };
  title?: string;
}

export interface RepositoryKnowledgeScan {
  schemaVersion: 1;
  projectId: string;
  policyId: string;
  scannerBuild: "repository-scanner-v1";
  snapshotId: string;
  contentSnapshotId: string;
  coverage: {
    included: number;
    excluded: number;
    unsupported: number;
    includedBytes: number;
    complete: boolean;
  };
  sources: RepositorySource[];
  units: RepositorySourceUnit[];
}

export type KnowledgeOperationAction = "create" | "update" | "delete" | "unchanged" | "conflict";

export interface KnowledgeFileOperation {
  path: string;
  action: KnowledgeOperationAction;
  ownership: "lervo_generated" | "managed_blocks";
  mediaType: "text/markdown" | "application/yaml" | "application/json" | "text/javascript";
  content?: string;
  expectedCurrentHash?: string;
  desiredHash: string;
  reason?: string;
}

export type KnowledgeMigrationOperation = KnowledgeFileOperation;

export interface KnowledgeMigrationPlan {
  schemaVersion: 1;
  planId: string;
  projectId: string;
  repositoryRoot: string;
  status: "ready" | "blocked";
  mode: "migrate" | "refresh";
  repairMode: "none" | "replace_unrecorded_structural_records";
  reconciliation: import("./incremental-reconciliation.js").IncrementalReconciliationSummary;
  sourceSnapshotId: string;
  policyHash: string;
  compiler: {
    id: "lervo.structural";
    version: "2";
    capability: "bounded_read_only_no_tools";
  };
  coverage: RepositoryKnowledgeScan["coverage"];
  impact: KnowledgeImpactSummary;
  impactReportId: string;
  operations: KnowledgeMigrationOperation[];
  registeredUserDocuments: number;
  generatedConcepts: number;
  entrypoints: {
    readme: RepositoryEntrypointDisposition;
    agents: RepositoryEntrypointDisposition;
    claude: RepositoryEntrypointDisposition;
  };
  agentArtifacts: {
    total: number;
    semanticSources: number;
    localInventoryOnly: number;
    reviewRequired: number;
    nonstandard: number;
    byRole: Partial<Record<RepositoryAgentArtifact["role"], number>>;
    items: Array<
      {
        path: string;
        status: SourceInventoryStatus;
        classification: SourceClassification;
      } & RepositoryAgentArtifact
    >;
  };
}

export interface RepositoryEntrypointDisposition {
  path: "README.md" | "AGENTS.md" | "CLAUDE.md";
  audience: "human" | "agent" | "provider_agent";
  status: "missing" | "present" | "present_generated";
  action: "create_generated" | "preserve_user" | "provider_bridge_required";
  reason: string;
}

export type KnowledgeFreshness = "current" | "stale" | "unknown";
export type KnowledgeImpactReason =
  "source_unit_changed" | "source_unit_missing" | "lineage_unavailable";

export interface KnowledgeImpactItem {
  subjectKind: "concept" | "claim" | "relation";
  subjectId: string;
  freshness: KnowledgeFreshness;
  evidence: { current: number; stale: number; unknown: number };
  reasons: KnowledgeImpactReason[];
}

export interface KnowledgeImpactSummary {
  current: number;
  stale: number;
  unknown: number;
  affectedConcepts: number;
}

export interface KnowledgeImpactReport {
  schemaVersion: 1;
  reportId: string;
  projectId: string;
  sourceSnapshotId: string;
  status: "current" | "affected" | "unknown";
  lineageComplete: boolean;
  summary: KnowledgeImpactSummary;
  items: KnowledgeImpactItem[];
}

export type KnowledgeRefreshReviewAction =
  "revalidate" | "consider_deprecation" | "resolve_lineage";

export interface KnowledgeRefreshReviewItem {
  reviewItemId: string;
  subjectKind: KnowledgeImpactItem["subjectKind"];
  subjectId: string;
  observedFreshness: Exclude<KnowledgeFreshness, "current">;
  reasons: KnowledgeImpactReason[];
  proposedAction: KnowledgeRefreshReviewAction;
  reviewRequired: true;
}

export interface KnowledgeRefreshReviewCandidate {
  schemaVersion: 1;
  candidateId: string;
  semantics: "review_candidate";
  projectId: string;
  sourceSnapshotId: string;
  impactReportId: string;
  status: "no_changes" | "review_required";
  automaticPublicationMutation: false;
  items: KnowledgeRefreshReviewItem[];
}

export interface KnowledgeMaterializationReceipt {
  schemaVersion: 1;
  type: "knowledge.materialization.applied";
  planId: string;
  projectId: string;
  sourceSnapshotId: string;
  appliedAt: string;
  created: string[];
  updated: string[];
  unchanged: string[];
  deleted: string[];
}

export interface KnowledgeLintIssue {
  code: string;
  severity: "error" | "warning";
  path: string;
  message: string;
}

export interface KnowledgeLintResult {
  schemaVersion: 1;
  repositoryRoot: string;
  valid: boolean;
  checkedConcepts: number;
  issues: KnowledgeLintIssue[];
}

export interface KnowledgeQueryHit {
  conceptId: string;
  title: string;
  path: string;
  ownership: "user" | "lervo_generated";
  score: number;
  matchedTerms: string[];
  assurance: "unreviewed" | "human_reviewed";
  freshness: KnowledgeFreshness;
  contentHash: string;
}

export interface KnowledgeRelationRecommendation {
  schemaVersion: 1;
  recommendationId: string;
  relationId: string;
  relationType: "depends_on" | "constrains" | "related_to" | "supersedes" | "contradicts";
  direction: "incoming" | "outgoing";
  seedConceptId: string;
  targetConceptId: string;
  documentId: string;
  path: string;
  sourceContentHash: string;
  sourceSnapshotId: string;
  impactReportId: string;
}

export interface KnowledgeRelationProjection {
  schemaVersion: 1;
  projectionId: string;
  sourceSnapshotId: string;
  impactReportId: string;
  conceptSidecarSetHash: string;
  relationSidecarSetHash: string;
  seedConceptIds: string[];
  limits: {
    readonly maximumSeeds: 5;
    readonly maximumExaminedRelations: 64;
    readonly maximumRecommendations: 5;
    readonly maximumSelections: 2;
    readonly hops: 1;
  };
  examinedRelationCount: number;
  truncated: boolean;
  recommendations: KnowledgeRelationRecommendation[];
}

export interface KnowledgeQueryResult {
  schemaVersion: 1;
  query: string;
  semantics: "recommended";
  sourceSnapshotId: string;
  impactReportId: string;
  hits: KnowledgeQueryHit[];
  relationProjection: KnowledgeRelationProjection;
}

export class RepositoryKnowledgeError extends Error {
  constructor(
    readonly code:
      | "knowledge_source_unsafe"
      | "knowledge_source_limit_exceeded"
      | "knowledge_evidence_source_invalid"
      | "knowledge_unit_extraction_failed"
      | "knowledge_compile_failed"
      | "knowledge_compile_policy_violation"
      | "knowledge_plan_stale"
      | "knowledge_reconciliation_conflict"
      | "knowledge_review_policy_invalid"
      | "knowledge_review_not_eligible"
      | "knowledge_review_write_failed"
      | "knowledge_approval_required"
      | "knowledge_apply_failed"
      | "knowledge_finalization_failed"
      | "knowledge_recovery_required"
      | "knowledge_recovery_not_found"
      | "knowledge_recovery_busy"
      | "knowledge_recovery_invalid"
      | "knowledge_rollback_failed"
      | "knowledge_impact_invalid"
      | "knowledge_lint_failed"
      | "document_directory_file_capacity_exceeded"
      | "document_directory_child_capacity_exceeded"
      | "document_repository_capacity_exceeded"
      | "document_role_conflict"
      | "document_role_policy_unresolved"
      | "document_rewrite_ownership_conflict"
      | "document_rewrite_rule_capacity_exceeded"
      | "document_rewriter_unmanaged"
      | "document_layout_permit_required"
      | "document_layout_permit_invalid",
    message: string,
    readonly publicDiagnostic?: { code: string; message: string },
  ) {
    super(message);
    this.name = "RepositoryKnowledgeError";
  }
}
