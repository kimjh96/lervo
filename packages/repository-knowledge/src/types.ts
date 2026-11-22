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
  contentHandling: "semantic_source" | "opaque_resource" | "local_inventory_only";
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
  /** Optional workstream staleness thresholds; defaults apply when absent. */
  workstream?: import("./workstream-freshness.js").WorkstreamFreshnessPolicy;
  /** Optional document freshness bounds (ADR-0463); defaults apply to absent keys. */
  documentFreshness?: import("./document-freshness-policy.js").DocumentFreshnessPolicySection;
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
  /** ADR-0544: hashed and change-tracked, but its text was released after the read. */
  contentRetention?: "observed_only";
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
  sourceUnitFailureMode?: "fail" | "file_only";
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

export type RepositoryScanPriorityClass =
  | "instructions"
  | "portable_skills"
  | "canonical_documents"
  | "other_documents"
  | "source_and_configuration"
  | "execution_evidence";

export interface RepositoryKnowledgeScan {
  schemaVersion: 1;
  projectId: string;
  policyId: string;
  scannerBuild: "repository-scanner-v1";
  snapshotId: string;
  contentSnapshotId: string;
  coverage: "complete" | "partial";
  skippedForBudget: { count: number; bytes: number; classes: RepositoryScanPriorityClass[] };
  /** Observed-only sources: known and change-tracked, not searched by symbol or section. */
  retention: {
    observedOnly: { count: number; bytes: number; classes: RepositoryScanPriorityClass[] };
  };
  inventoryCoverage: {
    included: number;
    excluded: number;
    unsupported: number;
    includedBytes: number;
    complete: boolean;
  };
  sources: RepositorySource[];
  units: RepositorySourceUnit[];
}

export interface RepositoryKnowledgePreparedScanOptions {
  /**
   * Reuses a scan prepared inside the same bounded, read-only inspection.
   * Consumers must not retain it across repository mutations.
   */
  preparedScan?: RepositoryKnowledgeScan;
}

export type KnowledgeOperationAction = "create" | "update" | "delete" | "unchanged" | "conflict";

export interface KnowledgeFileOperation {
  path: string;
  action: KnowledgeOperationAction;
  ownership: "lervo_generated" | "managed_blocks" | "user";
  mediaType: "text/markdown" | "application/yaml" | "application/json" | "text/javascript";
  content?: string;
  expectedCurrentHash?: string;
  desiredHash: string;
  reason?: string;
}

export type KnowledgeMigrationOperation = KnowledgeFileOperation;

export interface KnowledgeMigrationBlocker {
  code:
    | "document_layout_contract_invalid"
    | "document_layout_invalid_yaml"
    | "document_layout_unreadable";
  path: ".lervo/knowledge/document-layout.yaml";
  message: string;
  issues: import("@lervo/project").DecisionTaxonomyIssue[];
}

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
  coverage: RepositoryKnowledgeScan["inventoryCoverage"];
  impact: KnowledgeImpactSummary;
  impactReportId: string;
  operations: KnowledgeMigrationOperation[];
  /** Repository contracts that the apply-time validation would reject. */
  blockers: KnowledgeMigrationBlocker[];
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
  "source_unit_changed" | "source_unit_missing" | "lineage_unavailable" | "scan_incomplete";

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
  coverage: RepositoryKnowledgeScan["coverage"];
  skippedForBudget: RepositoryKnowledgeScan["skippedForBudget"];
  schemaVersion: 1;
  reportId: string;
  projectId: string;
  sourceSnapshotId: string;
  status: "current" | "affected" | "unknown";
  lineageComplete: boolean;
  summary: KnowledgeImpactSummary;
  items: KnowledgeImpactItem[];
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
  /** Repository-relative referenced path for reference and staleness findings; never content. */
  target?: string;
  /** Stable reason or signal names, for example `connected_path_changed`. */
  reasons?: string[];
}

export interface KnowledgeLintResult {
  coverage: RepositoryKnowledgeScan["coverage"];
  skippedForBudget: RepositoryKnowledgeScan["skippedForBudget"];
  schemaVersion: 1;
  repositoryRoot: string;
  valid: boolean;
  checkedConcepts: number;
  issues: KnowledgeLintIssue[];
  /** Document staleness coverage; absent when staleness was not evaluated for this lint. */
  documentStaleness?: {
    coverage: RepositoryKnowledgeScan["coverage"];
    status: "observed" | "unavailable";
    currentRevision: string | null;
    documents: number;
    evaluated: number;
    current: number;
    stale: number;
    unknown: number;
    unevaluated: number;
  };
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
  /** Present only on a historical document returned because the query targets history. */
  historical?: true;
}

export interface RepositoryKnowledgeRankerEntry {
  conceptId: string;
  title: string;
  path: string;
  contentHash: string;
  labels: string[];
  text: string;
}

export interface PreparedRepositoryKnowledgeQueryRanker {
  engine: { id: string; version: number };
  adapterBuildId: string;
  /** Optional rebuildable adapter projection. Never evidence or a replacement for current inputs. */
  preparationProjection?: unknown;
  /**
   * At most `limit` results, never more than the engine allows. `exclude` names concepts the
   * caller withholds; an adapter that honors it fills the page with the rest.
   */
  rank(input: {
    query: string;
    limit: number;
    exclude?: ReadonlySet<string>;
  }): Array<{ conceptId: string; score: number }>;
}

export interface RepositoryKnowledgeQueryRanker {
  prepare(
    entries: readonly RepositoryKnowledgeRankerEntry[],
    /** Adapters validate their own format and fall back to analyzing all current entries. */
    reuse?: { previousProjection: unknown },
  ): PreparedRepositoryKnowledgeQueryRanker | Promise<PreparedRepositoryKnowledgeQueryRanker>;
}

export interface KnowledgeQueryResult {
  schemaVersion: 1;
  query: string;
  semantics: "recommended";
  ranking?: {
    engine: { id: string; version: number };
    adapterBuildId: string;
  };
  coverage: RepositoryKnowledgeScan["coverage"];
  skippedForBudget: RepositoryKnowledgeScan["skippedForBudget"];
  retention: RepositoryKnowledgeScan["retention"];
  sourceSnapshotId: string;
  impactReportId: string;
  hits: KnowledgeQueryHit[];
}

export class RepositoryKnowledgeError extends Error {
  constructor(
    readonly code:
      | "knowledge_source_unsafe"
      | "source_bytes_changed"
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
      | "knowledge_materialization_busy"
      | "knowledge_materialization_wait_expired"
      | "knowledge_source_gate_invalid"
      | "knowledge_rollback_failed"
      | "knowledge_impact_invalid"
      | "knowledge_lint_failed"
      | "normalization_budget_exceeded"
      | "normalization_selection_invalid"
      | "normalization_usage_unavailable"
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
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RepositoryKnowledgeError";
  }
}
