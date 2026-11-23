import {
  providerCliAdmittedEventPayloadSchema,
  providerCliRejectedEventPayloadSchema,
} from "./provider-cli-event.js";
import {
  learningObservationRecordedEventPayloadSchema,
  knowledgeSkillCandidateProposedEventPayloadSchema,
  knowledgeSkillCandidateResolvedEventPayloadSchema,
  knowledgeSkillUsageAssessedEventPayloadSchema,
  knowledgeSkillRetiredEventPayloadSchema,
} from "./practice-event.js";
import {
  planItemCapturedEventPayloadSchema,
  planItemClosedEventPayloadSchema,
  planItemMissedEventPayloadSchema,
  planItemUpdatedEventPayloadSchema,
  planSummaryGapEventPayloadSchema,
  planTurnBlockedEventPayloadSchema,
} from "./plan-ledger-event.js";
import {
  applicationWorkspaceStartedEventPayloadSchema,
  terminalSessionEndedEventPayloadSchema,
  terminalSessionLaunchedEventPayloadSchema,
  terminalSessionLaunchPreparedEventPayloadSchema,
} from "./hosted-session-event.js";
import {
  contextQualityPreparedEventPayloadSchema,
  contextQualityVerifiedEventPayloadSchema,
} from "./context-quality-event.js";
import { contextQualityVerificationSchema } from "./context-quality-verification.js";
import {
  contextQualityIngressSchema,
  contextQualityBindingsSchema,
  contextQualityRequestSchema,
} from "./context-quality-request.js";
import { contextQualityEvidenceSchema, contextQualityPlanSchema } from "./context-quality-plan.js";
import { contextPreparationReportSchema } from "./context-preparation-report.js";
import {
  documentFreshnessEvidenceRecoveredEventPayloadSchema,
  documentFreshnessAssessmentRecordedEventPayloadSchema,
} from "./knowledge-maintenance-event.js";
import {
  repositoryKnowledgeBaselineRequestedEventPayloadSchema,
  repositoryKnowledgeStageRecordedEventPayloadSchema,
  repositoryKnowledgeConvergenceRecordedEventPayloadSchema,
} from "./knowledge-convergence-event.js";
import { convergenceAssignmentArchivedEventPayloadSchema } from "./convergence-assignment-archive-event.js";
import { assignmentAmendedEventPayloadSchema } from "./assignment-amendment-event.js";
import { assignmentReopenedEventPayloadSchema } from "./assignment-recovery-event.js";

import { adapterContractMessageSchema } from "./adapter.js";
import { agentLivenessObservedEventPayloadSchema } from "./agent-liveness-event.js";
import {
  agentContextHandoffRecordedEventPayloadSchema,
  agentContextPromotedEventPayloadSchema,
} from "./agent-context-event.js";
import {
  organizationAgentMembershipChangedEventPayloadSchema,
  organizationAgentIdentityChangedEventPayloadSchema,
  organizationChannelMembershipChangedEventPayloadSchema,
  organizationDeliberationParticipantBoundEventPayloadSchema,
  organizationDeliberationParticipantReleasedEventPayloadSchema,
  organizationExternalAgentDeploymentBoundEventPayloadSchema,
  organizationExternalAgentDeploymentRetiredEventPayloadSchema,
  organizationTeamBoundEventPayloadSchema,
  organizationTeamKindChangedEventPayloadSchema,
} from "./organization-agent-event.js";
import {
  adapterProcessObservationSchema,
  providerProcessObservedEventPayloadSchema,
} from "./adapter-process-observation.js";
import {
  assignmentCompletionPreparedEventPayloadSchema,
  assignmentCompletionReconciledEventPayloadSchema,
} from "./assignment-completion-event.js";
import { capabilityLockSchema, capabilityPackageManifestSchema } from "./capability-package.js";
import {
  adapterCapabilityActivationReceiptSchema,
  adapterCapabilityActivationRequestSchema,
  capabilityActivatedEventPayloadSchema,
  mcpRuntimeDescriptorSchema,
} from "./capability-activation.js";
import { contextEvidenceSchema } from "./context-evidence.js";
import { contextRecommendationEventPayloadSchema } from "./context-recommendation.js";
import { conversationAdapterDescriptorSchema } from "./conversation.js";
import { conversationRepositoryWorkCompletedEventPayloadSchema } from "./conversation-repository-work-event.js";
import { conversationRepositoryKnowledgeResolvedEventPayloadSchema } from "./conversation-repository-knowledge-event.js";
import {
  repositoryChangeCompletedEventPayloadSchema,
  repositoryKnowledgeResolvedEventPayloadSchema,
} from "./repository-change-event.js";
import {
  repositoryReplicaDivergedEventPayloadSchema,
  repositoryReplicaReconciledEventPayloadSchema,
} from "./repository-replica-event.js";
import {
  documentFreshnessCandidateAppliedEventPayloadSchema,
  documentFreshnessCandidateCreatedEventPayloadSchema,
  documentFreshnessCandidateRejectedEventPayloadSchema,
  documentFreshnessCandidateRevertedEventPayloadSchema,
  documentFreshnessCandidateVerifiedEventPayloadSchema,
  documentFreshnessCycleCompletedEventPayloadSchema,
} from "./document-freshness-event.js";
import {
  conversationKnowledgeCandidateRecordedEventPayloadSchema,
  knowledgeInstructionCandidateCapturedEventPayloadSchema,
  knowledgeInstructionCandidateExchangedEventPayloadSchema,
  knowledgeInstructionCaptureCycleCompletedEventPayloadSchema,
} from "./instruction-capture-event.js";
import { knowledgeConvergenceOwnerChangedEventPayloadSchema } from "./knowledge-convergence-owner-event.js";
import { knowledgeConvergenceDelegationContinuedEventPayloadSchema } from "./knowledge-convergence-delegation-continued-event.js";
import { knowledgeConvergenceDefinitionsInstalledEventPayloadSchema } from "./knowledge-convergence-definitions-installed-event.js";
import { knowledgePublicationRepairedEventPayloadSchema } from "./knowledge-publication-repaired-event.js";
import { knowledgeIntegrationTargetAbsorbedEventPayloadSchema } from "./knowledge-integration-target-absorbed-event.js";
import { conversationInboundEventSchema } from "./conversation-event.js";
import {
  conversationDeliveryReceiptSchema,
  conversationOutboundOriginSchema,
  conversationOutboundMessageSchema,
} from "./conversation-outbound.js";
import {
  conversationParticipationDecisionSchema,
  conversationParticipationPolicySchema,
} from "./conversation-participation.js";
import { deliberationArtifactSchema } from "./deliberation-artifact.js";
import {
  deliberationArtifactRecordedEventPayloadSchema,
  deliberationArtifactPublicationFailedEventPayloadSchema,
  deliberationCompletedEventPayloadSchema,
  deliberationStartedEventPayloadSchema,
} from "./deliberation-event.js";
import { deliberationOutcomeSchema } from "./deliberation-outcome.js";
import { deliberationParticipantAssignmentSchema } from "./deliberation-participant-assignment.js";
import { deliberationPolicySchema } from "./deliberation-policy.js";
import { deliberationWorkflowSourceSchema } from "./deliberation-workflow.js";
import {
  developmentPatternEffectObservedEventPayloadSchema,
  developmentPatternEvaluationRegisteredEventPayloadSchema,
  developmentPatternObservedEventPayloadSchema,
  developmentPatternTransitionedEventPayloadSchema,
} from "./development-pattern-event.js";
import { documentManifestSchema } from "./document-manifest.js";
import {
  documentMigrationAppliedEventPayloadSchema,
  documentMigrationApplyReceiptSchema,
  documentMigrationApprovalSchema,
} from "./document-migration-apply.js";
import {
  documentMigrationCandidateArtifactSchema,
  documentMigrationCandidateSchema,
  documentMigrationPlanSchema,
} from "./document-migration.js";
import { documentRegistrySchema } from "./document-registry.js";
import { documentStalenessResultSchema } from "./document-staleness.js";
import { doctorReportSchema } from "./doctor-report.js";
import { eventEnvelopeSchema } from "./event.js";
import { eventReaderCapabilitiesSchema } from "./event-reader-capabilities.js";
import {
  eventWriterActivationEvidenceSchema,
  eventWriterCoordinateSchema,
} from "./event-writer-coordinate.js";
import {
  executionStagesObservedEventPayloadSchema,
  resourceUsageRecordedEventPayloadSchema,
  workCausalityRecordedEventPayloadSchema,
} from "./execution-observability-event.js";
import { executionEnvironmentProfileSchema } from "./execution-environment-profile.js";
import { resourceAccountingDescriptorSchema } from "./resource-accounting.js";
import { workExecutionReportSchema } from "./work-execution-report.js";
import {
  eventSyncAcknowledgementSchema,
  outboundEventBatchSchema,
  projectRegistrationRequestSchema,
  projectRegistrationResponseSchema,
} from "./hub-sync.js";
import {
  hubPolicyApprovalWriteRequestSchema,
  hubPolicyRevocationWriteRequestSchema,
  hubPolicySnapshotWriteRequestSchema,
} from "./hub-policy.js";
import {
  legacyRegistryEntryArtifactSchema,
  legacyRegistryMigrationPlanSchema,
} from "./legacy-registry-migration.js";
import {
  legacyRegistryMigrationAppliedEventPayloadSchema,
  legacyRegistryMigrationApplyReceiptSchema,
  legacyRegistryMigrationApprovalSchema,
} from "./legacy-registry-migration-apply.js";
import {
  managedBlockPatchCandidateArtifactSchema,
  managedBlockPatchCandidateSchema,
} from "./managed-block-patch.js";
import { managedContextCoverageReportSchema } from "./managed-context-coverage-report.js";
import {
  adapterResultCapturedEventPayloadSchema,
  contextSelectedEventPayloadSchema,
  managedContextInjectedEventPayloadSchema,
  managedContextReferencedEventPayloadSchema,
} from "./managed-context-event.js";
import {
  knowledgeCandidateCreatedEventPayloadSchema,
  knowledgeCandidateReviewedEventPayloadSchema,
  knowledgeReconciliationReviewedEventPayloadSchema,
  knowledgeStaleDetectedEventPayloadSchema,
  knowledgeVerifiedEventPayloadSchema,
} from "./knowledge-event.js";
import { projectManifestSchema } from "./project.js";
import { projectIdentityMigratedEventPayloadSchema } from "./project-identity-migration.js";
import {
  policyApprovalRevocationSchema,
  policyApprovalSchema,
  policySnapshotSchema,
  managedRunApprovalAuthorizationSchema,
  signedPolicyApprovalRevocationSchema,
  signedPolicyApprovalSchema,
  signedPolicySnapshotSchema,
} from "./policy.js";
import {
  remoteCommandExecutionReceiptSchema,
  remoteCommandDeliveryAcknowledgementSchema,
  remoteCommandDeliveryConfirmationSchema,
  remoteCommandLeaseSchema,
  remoteCommandSchema,
  signedRemoteCommandSchema,
} from "./remote-command.js";
import { roleProfileSchema } from "./role.js";
import { roleEvaluationBundleSchema, roleEvaluationResultSchema } from "./role-evaluation.js";
import { roleProfileActivatedEventPayloadSchema } from "./role-profile-event.js";
import { highRiskRoleWorkflowSchema } from "./high-risk-role-workflow.js";
import { runCompletedEventPayloadSchema } from "./run-event.js";
import { handoffBundleSchema, sharedContextPublicationSchema } from "./shared-context.js";
import { statePrunedEventPayloadSchema } from "./state-pruned-event.js";
import { skillManifestSchema } from "./skill.js";
import { skillLockSchema } from "./skill-lock.js";
import { traceReportSchema } from "./trace-report.js";
import { tracePageReportSchema } from "./trace-page-report.js";
import { traceCapabilitiesReportSchema } from "./trace-capabilities-report.js";
import { terminalCoverageReportSchema } from "./terminal-coverage-report.js";
import {
  terminalBudgetPolicySchema,
  terminalBudgetReportSchema,
} from "./terminal-budget-report.js";
import {
  terminalSkillObservedEventPayloadSchema,
  terminalSkillTurnAssessedEventPayloadSchema,
} from "./terminal-skill-event.js";
import {
  terminalContextPreparedEventPayloadSchema,
  terminalReferenceObservedEventPayloadSchema,
  terminalTurnObservedEventPayloadSchema,
} from "./terminal-observation-event.js";
import { terminalTurnDeclaredEventPayloadSchema } from "./terminal-turn-declaration-event.js";
import { verificationResultSchema, verificationSuiteSchema } from "./verification.js";
import {
  verificationCompletedEventPayloadSchema,
  verificationStartedEventPayloadSchema,
} from "./verification-event.js";
import { writingContractSchema } from "./writing.js";
import { writingEvaluationSchema } from "./writing-evaluation.js";
import { writingPublicationPermitSchema } from "./writing-publication.js";
import {
  workstreamSnapshotRecordedEventPayloadSchema,
  workstreamSnapshotSchema,
} from "./workstream.js";
import {
  workstreamReplicationPublishRequestSchema,
  workstreamReplicationPublishResponseSchema,
  workstreamReplicationReadResponseSchema,
  workstreamReplicationRevisionResponseSchema,
} from "./workstream-replication.js";

export const schemaReferences = [
  documentManifestSchema,
  eventEnvelopeSchema,
  projectManifestSchema,
  policySnapshotSchema,
  policyApprovalSchema,
  policyApprovalRevocationSchema,
  signedPolicySnapshotSchema,
  signedPolicyApprovalSchema,
  signedPolicyApprovalRevocationSchema,
  managedRunApprovalAuthorizationSchema,
  remoteCommandSchema,
  signedRemoteCommandSchema,
  remoteCommandExecutionReceiptSchema,
  deliberationPolicySchema,
  managedContextCoverageReportSchema,
  contextPreparationReportSchema,
  contextQualityIngressSchema,
  contextQualityRequestSchema,
  contextQualityPlanSchema,
];

export const schemaCatalog = {
  agentContextPromotedEventPayload: agentContextPromotedEventPayloadSchema,
  agentContextHandoffRecordedEventPayload: agentContextHandoffRecordedEventPayloadSchema,
  agentLivenessObservedEventPayload: agentLivenessObservedEventPayloadSchema,
  adapterProcessObservation: adapterProcessObservationSchema,
  providerProcessObservedEventPayload: providerProcessObservedEventPayloadSchema,
  capabilityPackageManifest: capabilityPackageManifestSchema,
  capabilityLock: capabilityLockSchema,
  mcpRuntimeDescriptor: mcpRuntimeDescriptorSchema,
  adapterCapabilityActivationRequest: adapterCapabilityActivationRequestSchema,
  adapterCapabilityActivationReceipt: adapterCapabilityActivationReceiptSchema,
  capabilityActivatedEventPayload: capabilityActivatedEventPayloadSchema,
  project: projectManifestSchema,
  projectIdentityMigratedEventPayload: projectIdentityMigratedEventPayloadSchema,
  policySnapshot: policySnapshotSchema,
  signedPolicySnapshot: signedPolicySnapshotSchema,
  policyApproval: policyApprovalSchema,
  signedPolicyApproval: signedPolicyApprovalSchema,
  policyApprovalRevocation: policyApprovalRevocationSchema,
  signedPolicyApprovalRevocation: signedPolicyApprovalRevocationSchema,
  managedRunApprovalAuthorization: managedRunApprovalAuthorizationSchema,
  event: eventEnvelopeSchema,
  eventReaderCapabilities: eventReaderCapabilitiesSchema,
  eventWriterActivationEvidence: eventWriterActivationEvidenceSchema,
  eventWriterCoordinate: eventWriterCoordinateSchema,
  workCausalityRecordedEventPayload: workCausalityRecordedEventPayloadSchema,
  resourceUsageRecordedEventPayload: resourceUsageRecordedEventPayloadSchema,
  resourceAccountingDescriptor: resourceAccountingDescriptorSchema,
  workExecutionReport: workExecutionReportSchema,
  executionStagesObservedEventPayload: executionStagesObservedEventPayloadSchema,
  executionEnvironmentProfile: executionEnvironmentProfileSchema,
  projectRegistrationRequest: projectRegistrationRequestSchema,
  projectRegistrationResponse: projectRegistrationResponseSchema,
  outboundEventBatch: outboundEventBatchSchema,
  eventSyncAcknowledgement: eventSyncAcknowledgementSchema,
  hubPolicySnapshotWriteRequest: hubPolicySnapshotWriteRequestSchema,
  hubPolicyApprovalWriteRequest: hubPolicyApprovalWriteRequestSchema,
  hubPolicyRevocationWriteRequest: hubPolicyRevocationWriteRequestSchema,
  remoteCommand: remoteCommandSchema,
  signedRemoteCommand: signedRemoteCommandSchema,
  remoteCommandExecutionReceipt: remoteCommandExecutionReceiptSchema,
  remoteCommandLease: remoteCommandLeaseSchema,
  remoteCommandDeliveryAcknowledgement: remoteCommandDeliveryAcknowledgementSchema,
  remoteCommandDeliveryConfirmation: remoteCommandDeliveryConfirmationSchema,
  legacyRegistryEntryArtifact: legacyRegistryEntryArtifactSchema,
  legacyRegistryMigrationPlan: legacyRegistryMigrationPlanSchema,
  legacyRegistryMigrationApproval: legacyRegistryMigrationApprovalSchema,
  legacyRegistryMigrationAppliedEventPayload: legacyRegistryMigrationAppliedEventPayloadSchema,
  legacyRegistryMigrationApplyReceipt: legacyRegistryMigrationApplyReceiptSchema,
  contextEvidence: contextEvidenceSchema,
  contextRecommendationEventPayload: contextRecommendationEventPayloadSchema,
  conversationAdapterDescriptor: conversationAdapterDescriptorSchema,
  conversationInboundEvent: conversationInboundEventSchema,
  conversationParticipationPolicy: conversationParticipationPolicySchema,
  conversationParticipationDecision: conversationParticipationDecisionSchema,
  conversationOutboundOrigin: conversationOutboundOriginSchema,
  conversationOutboundMessage: conversationOutboundMessageSchema,
  conversationRepositoryWorkCompletedEventPayload:
    conversationRepositoryWorkCompletedEventPayloadSchema,
  conversationRepositoryKnowledgeResolvedEventPayload:
    conversationRepositoryKnowledgeResolvedEventPayloadSchema,
  convergenceAssignmentArchivedEventPayload: convergenceAssignmentArchivedEventPayloadSchema,
  repositoryKnowledgeBaselineRequestedEventPayload:
    repositoryKnowledgeBaselineRequestedEventPayloadSchema,
  repositoryKnowledgeStageRecordedEventPayload: repositoryKnowledgeStageRecordedEventPayloadSchema,
  repositoryKnowledgeConvergenceRecordedEventPayload:
    repositoryKnowledgeConvergenceRecordedEventPayloadSchema,
  repositoryChangeCompletedEventPayload: repositoryChangeCompletedEventPayloadSchema,
  repositoryKnowledgeResolvedEventPayload: repositoryKnowledgeResolvedEventPayloadSchema,
  repositoryReplicaDivergedEventPayload: repositoryReplicaDivergedEventPayloadSchema,
  repositoryReplicaReconciledEventPayload: repositoryReplicaReconciledEventPayloadSchema,
  documentFreshnessEvidenceRecoveredEventPayload:
    documentFreshnessEvidenceRecoveredEventPayloadSchema,
  documentFreshnessAssessmentRecordedEventPayload:
    documentFreshnessAssessmentRecordedEventPayloadSchema,
  documentFreshnessCandidateCreatedEventPayload:
    documentFreshnessCandidateCreatedEventPayloadSchema,
  documentFreshnessCandidateVerifiedEventPayload:
    documentFreshnessCandidateVerifiedEventPayloadSchema,
  documentFreshnessCandidateAppliedEventPayload:
    documentFreshnessCandidateAppliedEventPayloadSchema,
  documentFreshnessCandidateRejectedEventPayload:
    documentFreshnessCandidateRejectedEventPayloadSchema,
  documentFreshnessCandidateRevertedEventPayload:
    documentFreshnessCandidateRevertedEventPayloadSchema,
  documentFreshnessCycleCompletedEventPayload: documentFreshnessCycleCompletedEventPayloadSchema,
  knowledgeInstructionCandidateCapturedEventPayload:
    knowledgeInstructionCandidateCapturedEventPayloadSchema,
  conversationKnowledgeCandidateRecordedEventPayload:
    conversationKnowledgeCandidateRecordedEventPayloadSchema,
  knowledgeInstructionCaptureCycleCompletedEventPayload:
    knowledgeInstructionCaptureCycleCompletedEventPayloadSchema,
  knowledgeInstructionCandidateExchangedEventPayload:
    knowledgeInstructionCandidateExchangedEventPayloadSchema,
  knowledgeConvergenceOwnerChangedEventPayload: knowledgeConvergenceOwnerChangedEventPayloadSchema,
  providerCliAdmittedEventPayload: providerCliAdmittedEventPayloadSchema,
  providerCliRejectedEventPayload: providerCliRejectedEventPayloadSchema,
  knowledgeConvergenceDelegationContinuedEventPayload:
    knowledgeConvergenceDelegationContinuedEventPayloadSchema,
  knowledgeConvergenceDefinitionsInstalledEventPayload:
    knowledgeConvergenceDefinitionsInstalledEventPayloadSchema,
  knowledgePublicationRepairedEventPayload: knowledgePublicationRepairedEventPayloadSchema,
  knowledgeIntegrationTargetAbsorbedEventPayload:
    knowledgeIntegrationTargetAbsorbedEventPayloadSchema,
  conversationDeliveryReceipt: conversationDeliveryReceiptSchema,
  deliberationPolicy: deliberationPolicySchema,
  deliberationWorkflowSource: deliberationWorkflowSourceSchema,
  deliberationArtifact: deliberationArtifactSchema,
  deliberationOutcome: deliberationOutcomeSchema,
  deliberationParticipantAssignment: deliberationParticipantAssignmentSchema,
  deliberationStartedEventPayload: deliberationStartedEventPayloadSchema,
  deliberationArtifactRecordedEventPayload: deliberationArtifactRecordedEventPayloadSchema,
  deliberationArtifactPublicationFailedEventPayload:
    deliberationArtifactPublicationFailedEventPayloadSchema,
  deliberationCompletedEventPayload: deliberationCompletedEventPayloadSchema,
  // Historical development-pattern events retained for stored-event validation.
  developmentPatternObservedEventPayload: developmentPatternObservedEventPayloadSchema,
  developmentPatternTransitionedEventPayload: developmentPatternTransitionedEventPayloadSchema,
  developmentPatternEvaluationRegisteredEventPayload:
    developmentPatternEvaluationRegisteredEventPayloadSchema,
  developmentPatternEffectObservedEventPayload: developmentPatternEffectObservedEventPayloadSchema,
  adapter: adapterContractMessageSchema,
  role: roleProfileSchema,
  roleEvaluationBundle: roleEvaluationBundleSchema,
  roleEvaluationResult: roleEvaluationResultSchema,
  roleProfileActivatedEventPayload: roleProfileActivatedEventPayloadSchema,
  organizationTeamBoundEventPayload: organizationTeamBoundEventPayloadSchema,
  organizationTeamKindChangedEventPayload: organizationTeamKindChangedEventPayloadSchema,
  organizationAgentIdentityChangedEventPayload: organizationAgentIdentityChangedEventPayloadSchema,
  organizationAgentMembershipChangedEventPayload:
    organizationAgentMembershipChangedEventPayloadSchema,
  organizationExternalAgentDeploymentBoundEventPayload:
    organizationExternalAgentDeploymentBoundEventPayloadSchema,
  organizationExternalAgentDeploymentRetiredEventPayload:
    organizationExternalAgentDeploymentRetiredEventPayloadSchema,
  organizationChannelMembershipChangedEventPayload:
    organizationChannelMembershipChangedEventPayloadSchema,
  organizationDeliberationParticipantBoundEventPayload:
    organizationDeliberationParticipantBoundEventPayloadSchema,
  organizationDeliberationParticipantReleasedEventPayload:
    organizationDeliberationParticipantReleasedEventPayloadSchema,
  highRiskRoleWorkflow: highRiskRoleWorkflowSchema,
  runCompletedEventPayload: runCompletedEventPayloadSchema,
  assignmentCompletionPreparedEventPayload: assignmentCompletionPreparedEventPayloadSchema,
  assignmentAmendedEventPayload: assignmentAmendedEventPayloadSchema,
  assignmentReopenedEventPayload: assignmentReopenedEventPayloadSchema,
  assignmentCompletionReconciledEventPayload: assignmentCompletionReconciledEventPayloadSchema,
  statePrunedEventPayload: statePrunedEventPayloadSchema,
  sharedContext: sharedContextPublicationSchema,
  handoffBundle: handoffBundleSchema,
  skill: skillManifestSchema,
  skillLock: skillLockSchema,
  traceReport: traceReportSchema,
  tracePageReport: tracePageReportSchema,
  traceCapabilitiesReport: traceCapabilitiesReportSchema,
  terminalCoverageReport: terminalCoverageReportSchema,
  terminalBudgetPolicy: terminalBudgetPolicySchema,
  terminalBudgetReport: terminalBudgetReportSchema,
  contextQualityIngress: contextQualityIngressSchema,
  contextQualityBindings: contextQualityBindingsSchema,
  contextQualityRequest: contextQualityRequestSchema,
  contextQualityEvidence: contextQualityEvidenceSchema,
  contextQualityPlan: contextQualityPlanSchema,
  contextQualityVerification: contextQualityVerificationSchema,
  contextQualityPreparedEventPayload: contextQualityPreparedEventPayloadSchema,
  contextQualityVerifiedEventPayload: contextQualityVerifiedEventPayloadSchema,
  contextPreparationReport: contextPreparationReportSchema,
  managedContextCoverageReport: managedContextCoverageReportSchema,
  managedContextInjectedEventPayload: managedContextInjectedEventPayloadSchema,
  contextSelectedEventPayload: contextSelectedEventPayloadSchema,
  adapterResultCapturedEventPayload: adapterResultCapturedEventPayloadSchema,
  managedContextReferencedEventPayload: managedContextReferencedEventPayloadSchema,
  terminalContextPreparedEventPayload: terminalContextPreparedEventPayloadSchema,
  terminalTurnDeclaredEventPayload: terminalTurnDeclaredEventPayloadSchema,
  terminalReferenceObservedEventPayload: terminalReferenceObservedEventPayloadSchema,
  terminalTurnObservedEventPayload: terminalTurnObservedEventPayloadSchema,
  learningObservationRecordedEventPayload: learningObservationRecordedEventPayloadSchema,
  knowledgeSkillCandidateProposedEventPayload: knowledgeSkillCandidateProposedEventPayloadSchema,
  knowledgeSkillCandidateResolvedEventPayload: knowledgeSkillCandidateResolvedEventPayloadSchema,
  knowledgeSkillUsageAssessedEventPayload: knowledgeSkillUsageAssessedEventPayloadSchema,
  knowledgeSkillRetiredEventPayload: knowledgeSkillRetiredEventPayloadSchema,
  planItemCapturedEventPayload: planItemCapturedEventPayloadSchema,
  planItemUpdatedEventPayload: planItemUpdatedEventPayloadSchema,
  planItemClosedEventPayload: planItemClosedEventPayloadSchema,
  planSummaryGapEventPayload: planSummaryGapEventPayloadSchema,
  planTurnBlockedEventPayload: planTurnBlockedEventPayloadSchema,
  planItemMissedEventPayload: planItemMissedEventPayloadSchema,
  applicationWorkspaceStartedEventPayload: applicationWorkspaceStartedEventPayloadSchema,
  terminalSessionLaunchPreparedEventPayload: terminalSessionLaunchPreparedEventPayloadSchema,
  terminalSessionLaunchedEventPayload: terminalSessionLaunchedEventPayloadSchema,
  terminalSessionEndedEventPayload: terminalSessionEndedEventPayloadSchema,
  terminalSkillObservedEventPayload: terminalSkillObservedEventPayloadSchema,
  terminalSkillTurnAssessedEventPayload: terminalSkillTurnAssessedEventPayloadSchema,
  workstreamSnapshot: workstreamSnapshotSchema,
  workstreamSnapshotRecordedEventPayload: workstreamSnapshotRecordedEventPayloadSchema,
  workstreamReplicationPublishRequest: workstreamReplicationPublishRequestSchema,
  workstreamReplicationPublishResponse: workstreamReplicationPublishResponseSchema,
  workstreamReplicationReadResponse: workstreamReplicationReadResponseSchema,
  workstreamReplicationRevisionResponse: workstreamReplicationRevisionResponseSchema,
  documentRegistry: documentRegistrySchema,
  documentStalenessResult: documentStalenessResultSchema,
  doctorReport: doctorReportSchema,
  documentManifest: documentManifestSchema,
  documentMigrationApproval: documentMigrationApprovalSchema,
  documentMigrationAppliedEventPayload: documentMigrationAppliedEventPayloadSchema,
  documentMigrationApplyReceipt: documentMigrationApplyReceiptSchema,
  documentMigrationCandidate: documentMigrationCandidateSchema,
  documentMigrationCandidateArtifact: documentMigrationCandidateArtifactSchema,
  documentMigrationPlan: documentMigrationPlanSchema,
  managedBlockPatchCandidate: managedBlockPatchCandidateSchema,
  managedBlockPatchCandidateArtifact: managedBlockPatchCandidateArtifactSchema,
  knowledgeCandidateCreatedEventPayload: knowledgeCandidateCreatedEventPayloadSchema,
  knowledgeCandidateReviewedEventPayload: knowledgeCandidateReviewedEventPayloadSchema,
  knowledgeReconciliationReviewedEventPayload: knowledgeReconciliationReviewedEventPayloadSchema,
  knowledgeVerifiedEventPayload: knowledgeVerifiedEventPayloadSchema,
  knowledgeStaleDetectedEventPayload: knowledgeStaleDetectedEventPayloadSchema,
  writingContract: writingContractSchema,
  writingEvaluation: writingEvaluationSchema,
  writingPublicationPermit: writingPublicationPermitSchema,
  verificationSuite: verificationSuiteSchema,
  verificationResult: verificationResultSchema,
  verificationStartedEventPayload: verificationStartedEventPayloadSchema,
  verificationCompletedEventPayload: verificationCompletedEventPayloadSchema,
} satisfies Record<string, object>;

export type SchemaName = keyof typeof schemaCatalog;
