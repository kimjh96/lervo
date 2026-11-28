export { PRACTICE_EVENT_SCHEMA_VERSION } from "./practice-events.js";
export { noCapabilityJsonInvocationStrategy } from "./no-capability-json-strategy.js";
export {
  capturePlanItem,
  closePlanItem,
  PLAN_LEDGER_EVENT_SCHEMA_VERSION,
  PlanLedgerError,
  readPlanLedger,
  updatePlanItem,
  type PlanLedgerErrorCode,
} from "./plan-ledger-store.js";
export { closePlanItemsFromAssessment } from "./plan-ledger-closure.js";
export { hostModelSelectionDirectory, readHostModelSelection } from "./model-selection-host.js";
export { TERMINAL_SKILL_EVENT_SCHEMA_VERSION } from "./terminal-skill-events.js";
export { runAutonomousKnowledgeWorker } from "./worker.js";
export { readTerminalSkillUsage } from "./terminal-skill-usage-state.js";
export {
  enqueueTerminalSkillTurn,
  terminalTranscriptPosition,
  validTranscriptPosition,
  type TranscriptPosition,
} from "./terminal-skill-queue.js";
export { absentTerminalTranscript, newTranscriptStart } from "./terminal-transcript-position.js";
export { repositoryHeadIdentity } from "./repository-head-identity.js";
export {
  convergenceDelegationPlanHash,
  loadConvergenceDelegation,
  CONVERGENCE_DELEGATION_PATH,
  type ConvergenceDelegation,
  type ConvergenceRoleBinding,
} from "./delegation.js";
export { startAutonomousKnowledgeWorker } from "./loop.js";
export type {
  AutonomousKnowledgeWorkerInput,
  AutonomousKnowledgeWorkerResult,
} from "./loop-options.js";
export { foreignEventsHead, RESIDENT_AUTHORED_EVENT_TYPES } from "./resident-authored-events.js";
export { residentWakeKey } from "./convergence-queue-observation.js";
export { knowledgeCandidateStoreIdentity } from "./source-fingerprint.js";
export { acquireFullCycleAdmission, type FullCycleAdmission } from "./full-cycle-admission.js";
export { inspectAutonomousKnowledgeStatus, readAutonomousKnowledgeStatus } from "./status.js";
export {
  inspectKnowledgeResidentHealth,
  recordKnowledgeResidentHealth,
} from "./resident-health.js";
export { probeKnowledgeProviderAvailability } from "./provider-probe.js";
export {
  createConvergenceDelegationPlan,
  applyConvergenceDelegationPlan,
  type ConvergenceDelegationPlan,
} from "./delegation-plan.js";
export { runDocumentFreshnessCycle, type DocumentFreshnessCycleResult } from "./freshness-stage.js";
export { DocumentFreshnessOperationError } from "./freshness-document-io.js";
export { revertFreshnessCandidate } from "./freshness-revert.js";
export {
  acknowledgeFreshnessCandidate,
  documentFreshnessAttentionSources,
  documentFreshnessSummary,
  inspectDocumentFreshnessStatus,
  listDocumentFreshnessReview,
  renderDocumentFreshnessDiff,
  requireFreshnessCandidate,
  withDocumentFreshnessOwnerLock,
  type DocumentFreshnessStatusReport,
} from "./freshness-review.js";
export { assertFreshnessEventsWritable } from "./freshness-events.js";
export {
  enqueueInstructionCapture,
  readPrecedingAgentTurn,
  recordPrecedingAgentTurn,
  listQueuedInstructionCaptures,
  type InstructionCaptureEnqueueResult,
} from "./instruction-capture-queue.js";
export {
  dismissHeldCapture,
  readInstructionCaptureState,
  type HeldCapture,
  type InstructionCaptureState,
} from "./instruction-capture-state.js";
export {
  runInstructionCaptureCycle,
  type InstructionCaptureCycleResult,
} from "./instruction-capture-stage.js";
export {
  ConvergenceOwnership,
  type ConvergenceOwnerLeasePort,
  type ConvergenceOwnerLeaseTransport,
} from "./convergence-owner.js";
export {
  readConvergenceOwnerFence,
  readRepositoryKnowledgeJobAdmission,
  repositoryKnowledgeJobAdmission,
} from "./convergence-owner-fence.js";
export { readConvergenceOwnerHost, CONVERGENCE_OWNER_HOST_PATH } from "./convergence-owner-host.js";
export {
  watchHubKnowledgeChanges,
  type HubKnowledgeChangeIssue,
  type HubKnowledgeChangeWatch,
  type KnowledgeHubChangePort,
  type KnowledgeHubChangeTransport,
} from "./hub-knowledge-changes.js";
export type { ConvergenceOwnerVerdict } from "./convergence-owner-verdict.js";
export {
  publishKnowledgeOutputs,
  type KnowledgePublicationOutcome,
} from "./knowledge-publication.js";
export { createGitHubKnowledgePublicationForge } from "./knowledge-publication-github.js";
export type { KnowledgePublicationForge } from "./knowledge-publication-forge.js";
export { readKnowledgePublicationState } from "./knowledge-publication-state.js";
export {
  unpublishedKnowledgeCommits,
  type KnowledgePublicationBase,
} from "./knowledge-publication-unpublished.js";
export { KNOWLEDGE_OUTPUT_COMMIT_AUTHOR } from "./knowledge-output-commit.js";
export {
  acknowledgeKnowledgePublicationAttention,
  readKnowledgePublicationAcknowledged,
  type KnowledgePublicationAcknowledged,
} from "./knowledge-publication-tracking.js";
export { knowledgePublicationWaitExhausted } from "./knowledge-publication-wait.js";
export type { KnowledgePublicationRepairEvents } from "./knowledge-publication-repair.js";
export { reconcileKnowledgeSupersession } from "./knowledge-supersession.js";
export {
  parseKnowledgeSupersessionEntries,
  parseKnowledgeSupersessionReconciliation,
  readKnowledgeSupersessionLedger,
  type KnowledgeSupersessionEntry,
  type KnowledgeSupersessionReconciliation,
} from "./knowledge-supersession-ledger.js";
export {
  exchangeInstructionCandidates,
  type InstructionCandidateExchangePort,
  type InstructionCandidateExchangeResult,
  type InstructionCandidateExchangeTransport,
} from "./instruction-candidate-exchange.js";
export {
  readInstructionCandidateExchangeState,
  recordInstructionCandidateResolution,
} from "./instruction-candidate-exchange-state.js";
export {
  applyDurableInstructionCandidate,
  InstructionApplyNotOnBaseError,
  InstructionApplyOwnerElsewhereError,
  InstructionCommitPendingError,
  LERVO_INSTRUCTION_SETTLER,
  type AppliedDurableInstruction,
} from "./durable-instruction-apply.js";
export {
  applyStoredInstructionCandidates,
  type InstructionCandidateApplyResult,
} from "./durable-instruction-auto-apply.js";
export {
  readInstructionApplyFailures,
  type InstructionApplyFailure,
} from "./instruction-apply-failures.js";
export { collectLocalKnowledgeSources } from "./knowledge-supplemental-sources.js";
export {
  commitAppliedInstructionCandidate,
  commitRetiredInstruction,
  appliedInstructionCandidateCommitted,
  instructionCandidateApplyAuthority,
  type InstructionCandidateApplyAuthority,
} from "./instruction-candidate-apply-authority.js";
export type { OwnerTurnCaptureWorkResult } from "./owner-turn-capture-work.js";
export {
  ConvergenceContinuity,
  type ConvergenceContinuityInput,
  type ConvergenceHostRecordPort,
  type ConvergenceHostRecordTransport,
} from "./convergence-continuity.js";
export type { ConvergenceDefinitionPort } from "./delegation-definition-exchange.js";
export {
  convergenceHostLabel,
  type ConvergenceOwnerHubCandidate,
} from "./convergence-owner-host-derivation.js";
export {
  continuityPolicyFromDelegation,
  sealConvergenceContinuityPolicy,
  DEFAULT_CONTINUITY_HORIZON_DAYS,
  DEFAULT_CONTINUITY_RENEWAL,
  type ConvergenceContinuityPolicy,
} from "./continuity-policy.js";
export {
  convergenceContinuityPolicyPath,
  defaultConvergenceContinuityPolicyPath,
  readConvergenceContinuityPolicy,
  writeConvergenceContinuityPolicy,
  type ConvergenceContinuityPolicyReading,
} from "./continuity-policy-store.js";
export {
  readConvergenceContinuityState,
  type ContinuityPeerSummary,
  type ConvergenceContinuityState,
} from "./continuity-state.js";
export { continuityPeerSummary } from "./continuity-host-record.js";
export {
  continuityFindings,
  continuityPeerFindings,
  localContinuityFindings,
  type ContinuityFinding,
  type ContinuityFindingCode,
  type ContinuityFindingSeverity,
} from "./continuity-findings.js";
export { convergenceDelegationScopeHash } from "./delegation-scope.js";
export { probeKnowledgePublicationSettings } from "./knowledge-publication-readiness.js";
export {
  inspectConvergenceContinuity,
  type ConvergenceContinuityInspection,
} from "./continuity-inspection.js";
export {
  KNOWLEDGE_RESIDENT_EVENT_SCHEMA_VERSION,
  knowledgeResidentHoldReason,
  startKnowledgeResidentHold,
  type KnowledgeResidentHoldReason,
} from "./resident-admission.js";
export {
  hostKnowledgeResidentStatusPath,
  hostResidentScanStalled,
  readHostKnowledgeResidentStatus,
  writeHostKnowledgeResidentStatus,
  type HostKnowledgeResidentReading,
  type HostKnowledgeResidentStatus,
  type HostResidentRepository,
} from "./host-resident-status.js";
export {
  acquireHostKnowledgeResidentLock,
  hostKnowledgeResidentLockPath,
  type HostKnowledgeResidentLock,
} from "./host-resident-lock.js";
export { observeResidentHost, type ResidentHostObservation } from "./resident-host-observation.js";
export {
  convergenceAgentName,
  convergenceDelegationAgentIds,
  lervoAgentIds,
  retireSupersededConvergenceAgents,
} from "./convergence-roster.js";
export { classifyForegroundDocumentRoutes } from "./foreground-document-route-classification.js";
export {
  observeDocumentDeferrals,
  inspectDocumentDeferralHealth,
} from "./document-deferral-health.js";
export { inspectDocumentRouteResolutionContext } from "./document-route-resolution-context.js";

export { residentCycleFailure } from "./resident-cycle-failure.js";

export { createChangeReviewHost } from "./change-review-host.js";

export { admittedBackgroundContext, backgroundProviderOptions } from "./background-provider.js";

export { createBackgroundNormalizationCompiler } from "./background-normalization-compiler.js";

export {
  planProjectConvergenceArtifactRetention,
  type CasRetentionPlan,
} from "./cas-retention-plan.js";
export {
  lifecyclePlanReviewVerdict,
  prepareLifecyclePlanCrossCheck,
} from "./lifecycle-plan-review-input.js";
export { readWorkerProviderSelection } from "./provider-cli-selection.js";
export { lifecycleChangedPaths } from "./lifecycle-plan-scope.js";
export {
  checkoutOnBaseBranch,
  gitVisiblePaths,
  repositoryBaseBranch,
  repositoryCommittable,
} from "./checkout-base-branch.js";
export {
  commitKnowledgeEffect,
  commitKnowledgePaths,
  GENERATED_EFFECT_CROSS_CHECK,
  knowledgeEffectUndoCommand,
  KNOWLEDGE_EFFECT_KINDS,
  KNOWLEDGE_EFFECT_TRAILERS,
  type KnowledgeCommitResult,
  type KnowledgeEffectKind,
  type KnowledgeEffectNotice,
} from "./knowledge-effect-commit.js";
// ADR-0561: the owner's repository hold, for runtimes that do not read the registry directly.
export {
  holdRepository,
  readRepositoryHold,
  releaseRepositoryHold,
  repositoryReleaseCommand,
  shellWord,
  type RepositoryHold,
} from "@lervo/repository-registry";
export {
  applyCommittedKnowledgeEffect,
  knowledgeEffectPreflight,
  knowledgeEffectUserPaths,
  KnowledgeEffectOwnerHoldError,
  KnowledgeEffectUncommittedError,
  type KnowledgeEffectHold,
} from "./knowledge-effect-guard.js";
export {
  STALE_GIT_INDEX_LOCK_AGE_MS,
  staleGitIndexLock,
  staleGitIndexLockInstruction,
  type StaleGitIndexLock,
} from "./git-index-lock.js";
export { lifecycleUserContentPaths } from "./lifecycle-plan-scope.js";
export { subscribeKnowledgeWakeups } from "./knowledge-worker-wakeups.js";
export { watchRepositoryChanges } from "./repository-change-watch.js";
export { requestKnowledgeResidentCycle } from "./knowledge-resident-request.js";
export {
  issueAttention,
  readRepositoryWatchIssues,
  REPOSITORY_WATCH_STATE_DIRECTORY,
  repositoryWatchReporter,
  type RepositoryWatchIssue,
  type WakeSourceIssueCode,
} from "./repository-watch-state.js";
export { watchFiles } from "./resident-file-watch.js";
export {
  readPrivateJsonFile,
  writePrivateJsonFile,
  writePrivateTextFile,
} from "./private-state-file.js";
