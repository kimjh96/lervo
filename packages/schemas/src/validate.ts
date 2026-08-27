import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

import { adapterContractMessageSchema } from "./adapter.js";
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
import { conversationInboundEventSchema } from "./conversation-event.js";
import {
  conversationDeliveryReceiptSchema,
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
import { deliberationPolicySchema } from "./deliberation-policy.js";
import { deliberationWorkflowSourceSchema } from "./deliberation-workflow.js";
import {
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
  managedContextInjectedEventPayloadSchema,
  managedContextReferencedEventPayloadSchema,
} from "./managed-context-event.js";
import { knowledgeCandidateSchema } from "./knowledge.js";
import {
  organizationDeploymentPolicySchema,
  organizationRuntimeCredentialDeliveryReceiptSchema,
  organizationRuntimeCredentialGrantSchema,
  organizationRuntimeCredentialRevocationSchema,
  signedOrganizationDeploymentPolicySchema,
} from "./organization-deployment.js";
import {
  organizationFleetRolloutApprovalSchema,
  organizationFleetRolloutPlanSchema,
  organizationFleetWaveObservationSchema,
  organizationNodeEnrollmentSchema,
} from "./organization-fleet.js";
import {
  organizationNodeRolloutExecutionPlanSchema,
  organizationNodeRolloutExecutionReceiptSchema,
} from "./organization-rollout-execution.js";
import {
  organizationNodeRolloutDeliveryReceiptSchema,
  organizationNodeRolloutDeliverySchema,
  signedOrganizationNodeRolloutDeliverySchema,
} from "./organization-rollout-delivery.js";
import {
  organizationNodeRolloutRecoveryObservationSchema,
  organizationNodeRolloutRecoveryReceiptSchema,
} from "./organization-rollout-recovery.js";
import {
  organizationNodeRolloutRollbackPlanSchema,
  organizationNodeRolloutRollbackReceiptSchema,
} from "./organization-rollout-rollback.js";
import {
  organizationNodeRollbackDeliveryReceiptSchema,
  organizationNodeRollbackDeliverySchema,
  organizationNodeRollbackRecoveryReceiptSchema,
  signedOrganizationNodeRollbackDeliverySchema,
} from "./organization-rollback-delivery.js";
import {
  knowledgeCandidateCreatedEventPayloadSchema,
  knowledgeCandidateReviewedEventPayloadSchema,
  knowledgeReconciliationReviewedEventPayloadSchema,
  knowledgeStaleDetectedEventPayloadSchema,
  knowledgeVerifiedEventPayloadSchema,
} from "./knowledge-event.js";
import {
  knowledgePromotionPolicySchema,
  knowledgeReviewApprovalSchema,
  knowledgeStalenessResultSchema,
  verifiedKnowledgeSchema,
} from "./knowledge-lifecycle.js";
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
} from "./workstream-replication.js";

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("date-time", {
  type: "string",
  validate: (value: string) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value)),
});
ajv.addSchema(documentManifestSchema);
ajv.addSchema(eventEnvelopeSchema);
ajv.addSchema(projectManifestSchema);
ajv.addSchema(policySnapshotSchema);
ajv.addSchema(policyApprovalSchema);
ajv.addSchema(policyApprovalRevocationSchema);
ajv.addSchema(signedPolicySnapshotSchema);
ajv.addSchema(signedPolicyApprovalSchema);
ajv.addSchema(signedPolicyApprovalRevocationSchema);
ajv.addSchema(managedRunApprovalAuthorizationSchema);
ajv.addSchema(remoteCommandSchema);
ajv.addSchema(signedRemoteCommandSchema);
ajv.addSchema(remoteCommandExecutionReceiptSchema);
ajv.addSchema(deliberationPolicySchema);
ajv.addSchema(managedContextCoverageReportSchema);
ajv.addSchema(organizationDeploymentPolicySchema);
ajv.addSchema(signedOrganizationDeploymentPolicySchema);
ajv.addSchema(organizationFleetRolloutPlanSchema);
ajv.addSchema(organizationFleetRolloutApprovalSchema);
ajv.addSchema(organizationFleetWaveObservationSchema);
ajv.addSchema(organizationNodeEnrollmentSchema);
ajv.addSchema(organizationNodeRolloutExecutionPlanSchema);
ajv.addSchema(organizationNodeRolloutExecutionReceiptSchema);
ajv.addSchema(organizationNodeRolloutDeliverySchema);
ajv.addSchema(signedOrganizationNodeRolloutDeliverySchema);
ajv.addSchema(organizationNodeRolloutDeliveryReceiptSchema);
ajv.addSchema(organizationNodeRolloutRecoveryObservationSchema);
ajv.addSchema(organizationNodeRolloutRecoveryReceiptSchema);
ajv.addSchema(organizationNodeRolloutRollbackPlanSchema);
ajv.addSchema(organizationNodeRolloutRollbackReceiptSchema);
ajv.addSchema(organizationNodeRollbackDeliverySchema);
ajv.addSchema(signedOrganizationNodeRollbackDeliverySchema);
ajv.addSchema(organizationNodeRollbackDeliveryReceiptSchema);
ajv.addSchema(organizationNodeRollbackRecoveryReceiptSchema);

const validators = {
  capabilityPackageManifest: ajv.compile(capabilityPackageManifestSchema),
  capabilityLock: ajv.compile(capabilityLockSchema),
  mcpRuntimeDescriptor: ajv.compile(mcpRuntimeDescriptorSchema),
  adapterCapabilityActivationRequest: ajv.compile(adapterCapabilityActivationRequestSchema),
  adapterCapabilityActivationReceipt: ajv.compile(adapterCapabilityActivationReceiptSchema),
  capabilityActivatedEventPayload: ajv.compile(capabilityActivatedEventPayloadSchema),
  project: ajv.getSchema(projectManifestSchema.$id)!,
  projectIdentityMigratedEventPayload: ajv.compile(projectIdentityMigratedEventPayloadSchema),
  policySnapshot: ajv.getSchema(policySnapshotSchema.$id)!,
  signedPolicySnapshot: ajv.getSchema(signedPolicySnapshotSchema.$id)!,
  policyApproval: ajv.getSchema(policyApprovalSchema.$id)!,
  signedPolicyApproval: ajv.getSchema(signedPolicyApprovalSchema.$id)!,
  policyApprovalRevocation: ajv.getSchema(policyApprovalRevocationSchema.$id)!,
  signedPolicyApprovalRevocation: ajv.getSchema(signedPolicyApprovalRevocationSchema.$id)!,
  managedRunApprovalAuthorization: ajv.getSchema(managedRunApprovalAuthorizationSchema.$id)!,
  event: ajv.getSchema(eventEnvelopeSchema.$id)!,
  projectRegistrationRequest: ajv.compile(projectRegistrationRequestSchema),
  projectRegistrationResponse: ajv.compile(projectRegistrationResponseSchema),
  outboundEventBatch: ajv.compile(outboundEventBatchSchema),
  eventSyncAcknowledgement: ajv.compile(eventSyncAcknowledgementSchema),
  hubPolicySnapshotWriteRequest: ajv.compile(hubPolicySnapshotWriteRequestSchema),
  hubPolicyApprovalWriteRequest: ajv.compile(hubPolicyApprovalWriteRequestSchema),
  hubPolicyRevocationWriteRequest: ajv.compile(hubPolicyRevocationWriteRequestSchema),
  remoteCommand: ajv.getSchema(remoteCommandSchema.$id)!,
  signedRemoteCommand: ajv.getSchema(signedRemoteCommandSchema.$id)!,
  remoteCommandExecutionReceipt: ajv.getSchema(remoteCommandExecutionReceiptSchema.$id)!,
  remoteCommandLease: ajv.compile(remoteCommandLeaseSchema),
  remoteCommandDeliveryAcknowledgement: ajv.compile(remoteCommandDeliveryAcknowledgementSchema),
  remoteCommandDeliveryConfirmation: ajv.compile(remoteCommandDeliveryConfirmationSchema),
  legacyRegistryEntryArtifact: ajv.compile(legacyRegistryEntryArtifactSchema),
  legacyRegistryMigrationPlan: ajv.compile(legacyRegistryMigrationPlanSchema),
  legacyRegistryMigrationApproval: ajv.compile(legacyRegistryMigrationApprovalSchema),
  legacyRegistryMigrationAppliedEventPayload: ajv.compile(
    legacyRegistryMigrationAppliedEventPayloadSchema,
  ),
  legacyRegistryMigrationApplyReceipt: ajv.compile(legacyRegistryMigrationApplyReceiptSchema),
  contextEvidence: ajv.compile(contextEvidenceSchema),
  contextRecommendationEventPayload: ajv.compile(contextRecommendationEventPayloadSchema),
  conversationAdapterDescriptor: ajv.compile(conversationAdapterDescriptorSchema),
  conversationInboundEvent: ajv.compile(conversationInboundEventSchema),
  conversationParticipationPolicy: ajv.compile(conversationParticipationPolicySchema),
  conversationParticipationDecision: ajv.compile(conversationParticipationDecisionSchema),
  conversationOutboundMessage: ajv.compile(conversationOutboundMessageSchema),
  conversationDeliveryReceipt: ajv.compile(conversationDeliveryReceiptSchema),
  deliberationPolicy: ajv.getSchema(deliberationPolicySchema.$id)!,
  deliberationWorkflowSource: ajv.compile(deliberationWorkflowSourceSchema),
  deliberationArtifact: ajv.compile(deliberationArtifactSchema),
  deliberationOutcome: ajv.compile(deliberationOutcomeSchema),
  deliberationStartedEventPayload: ajv.compile(deliberationStartedEventPayloadSchema),
  deliberationArtifactRecordedEventPayload: ajv.compile(
    deliberationArtifactRecordedEventPayloadSchema,
  ),
  deliberationArtifactPublicationFailedEventPayload: ajv.compile(
    deliberationArtifactPublicationFailedEventPayloadSchema,
  ),
  deliberationCompletedEventPayload: ajv.compile(deliberationCompletedEventPayloadSchema),
  developmentPatternObservedEventPayload: ajv.compile(developmentPatternObservedEventPayloadSchema),
  developmentPatternTransitionedEventPayload: ajv.compile(
    developmentPatternTransitionedEventPayloadSchema,
  ),
  adapter: ajv.compile(adapterContractMessageSchema),
  role: ajv.compile(roleProfileSchema),
  roleEvaluationBundle: ajv.compile(roleEvaluationBundleSchema),
  roleEvaluationResult: ajv.compile(roleEvaluationResultSchema),
  highRiskRoleWorkflow: ajv.compile(highRiskRoleWorkflowSchema),
  runCompletedEventPayload: ajv.compile(runCompletedEventPayloadSchema),
  statePrunedEventPayload: ajv.compile(statePrunedEventPayloadSchema),
  sharedContext: ajv.compile(sharedContextPublicationSchema),
  handoffBundle: ajv.compile(handoffBundleSchema),
  skill: ajv.compile(skillManifestSchema),
  skillLock: ajv.compile(skillLockSchema),
  traceReport: ajv.compile(traceReportSchema),
  tracePageReport: ajv.compile(tracePageReportSchema),
  traceCapabilitiesReport: ajv.compile(traceCapabilitiesReportSchema),
  terminalCoverageReport: ajv.compile(terminalCoverageReportSchema),
  managedContextCoverageReport: ajv.getSchema(managedContextCoverageReportSchema.$id)!,
  managedContextInjectedEventPayload: ajv.compile(managedContextInjectedEventPayloadSchema),
  adapterResultCapturedEventPayload: ajv.compile(adapterResultCapturedEventPayloadSchema),
  managedContextReferencedEventPayload: ajv.compile(managedContextReferencedEventPayloadSchema),
  terminalContextPreparedEventPayload: ajv.compile(terminalContextPreparedEventPayloadSchema),
  terminalTurnDeclaredEventPayload: ajv.compile(terminalTurnDeclaredEventPayloadSchema),
  terminalReferenceObservedEventPayload: ajv.compile(terminalReferenceObservedEventPayloadSchema),
  terminalTurnObservedEventPayload: ajv.compile(terminalTurnObservedEventPayloadSchema),
  workstreamSnapshot: ajv.compile(workstreamSnapshotSchema),
  workstreamSnapshotRecordedEventPayload: ajv.compile(workstreamSnapshotRecordedEventPayloadSchema),
  workstreamReplicationPublishRequest: ajv.compile(workstreamReplicationPublishRequestSchema),
  workstreamReplicationPublishResponse: ajv.compile(workstreamReplicationPublishResponseSchema),
  workstreamReplicationReadResponse: ajv.compile(workstreamReplicationReadResponseSchema),
  documentRegistry: ajv.compile(documentRegistrySchema),
  documentStalenessResult: ajv.compile(documentStalenessResultSchema),
  doctorReport: ajv.compile(doctorReportSchema),
  documentManifest: ajv.getSchema(documentManifestSchema.$id)!,
  documentMigrationApproval: ajv.compile(documentMigrationApprovalSchema),
  documentMigrationAppliedEventPayload: ajv.compile(documentMigrationAppliedEventPayloadSchema),
  documentMigrationApplyReceipt: ajv.compile(documentMigrationApplyReceiptSchema),
  documentMigrationCandidate: ajv.compile(documentMigrationCandidateSchema),
  documentMigrationCandidateArtifact: ajv.compile(documentMigrationCandidateArtifactSchema),
  documentMigrationPlan: ajv.compile(documentMigrationPlanSchema),
  managedBlockPatchCandidate: ajv.compile(managedBlockPatchCandidateSchema),
  managedBlockPatchCandidateArtifact: ajv.compile(managedBlockPatchCandidateArtifactSchema),
  knowledgeCandidate: ajv.compile(knowledgeCandidateSchema),
  organizationDeploymentPolicy: ajv.getSchema(organizationDeploymentPolicySchema.$id)!,
  signedOrganizationDeploymentPolicy: ajv.getSchema(signedOrganizationDeploymentPolicySchema.$id)!,
  organizationRuntimeCredentialGrant: ajv.compile(organizationRuntimeCredentialGrantSchema),
  organizationRuntimeCredentialRevocation: ajv.compile(
    organizationRuntimeCredentialRevocationSchema,
  ),
  organizationRuntimeCredentialDeliveryReceipt: ajv.compile(
    organizationRuntimeCredentialDeliveryReceiptSchema,
  ),
  organizationNodeEnrollment: ajv.compile(organizationNodeEnrollmentSchema),
  organizationFleetRolloutPlan: ajv.compile(organizationFleetRolloutPlanSchema),
  organizationFleetWaveObservation: ajv.compile(organizationFleetWaveObservationSchema),
  organizationFleetRolloutApproval: ajv.compile(organizationFleetRolloutApprovalSchema),
  organizationNodeRolloutExecutionPlan: ajv.compile(organizationNodeRolloutExecutionPlanSchema),
  organizationNodeRolloutExecutionReceipt: ajv.compile(
    organizationNodeRolloutExecutionReceiptSchema,
  ),
  organizationNodeRolloutDelivery: ajv.getSchema(organizationNodeRolloutDeliverySchema.$id)!,
  signedOrganizationNodeRolloutDelivery: ajv.getSchema(
    signedOrganizationNodeRolloutDeliverySchema.$id,
  )!,
  organizationNodeRolloutDeliveryReceipt: ajv.getSchema(
    organizationNodeRolloutDeliveryReceiptSchema.$id,
  )!,
  organizationNodeRolloutRecoveryObservation: ajv.getSchema(
    organizationNodeRolloutRecoveryObservationSchema.$id,
  )!,
  organizationNodeRolloutRecoveryReceipt: ajv.getSchema(
    organizationNodeRolloutRecoveryReceiptSchema.$id,
  )!,
  organizationNodeRolloutRollbackPlan: ajv.getSchema(
    organizationNodeRolloutRollbackPlanSchema.$id,
  )!,
  organizationNodeRolloutRollbackReceipt: ajv.getSchema(
    organizationNodeRolloutRollbackReceiptSchema.$id,
  )!,
  organizationNodeRollbackDelivery: ajv.getSchema(organizationNodeRollbackDeliverySchema.$id)!,
  signedOrganizationNodeRollbackDelivery: ajv.getSchema(
    signedOrganizationNodeRollbackDeliverySchema.$id,
  )!,
  organizationNodeRollbackDeliveryReceipt: ajv.getSchema(
    organizationNodeRollbackDeliveryReceiptSchema.$id,
  )!,
  organizationNodeRollbackRecoveryReceipt: ajv.getSchema(
    organizationNodeRollbackRecoveryReceiptSchema.$id,
  )!,
  knowledgePromotionPolicy: ajv.compile(knowledgePromotionPolicySchema),
  knowledgeReviewApproval: ajv.compile(knowledgeReviewApprovalSchema),
  verifiedKnowledge: ajv.compile(verifiedKnowledgeSchema),
  knowledgeStalenessResult: ajv.compile(knowledgeStalenessResultSchema),
  knowledgeCandidateCreatedEventPayload: ajv.compile(knowledgeCandidateCreatedEventPayloadSchema),
  knowledgeCandidateReviewedEventPayload: ajv.compile(knowledgeCandidateReviewedEventPayloadSchema),
  knowledgeReconciliationReviewedEventPayload: ajv.compile(
    knowledgeReconciliationReviewedEventPayloadSchema,
  ),
  knowledgeVerifiedEventPayload: ajv.compile(knowledgeVerifiedEventPayloadSchema),
  knowledgeStaleDetectedEventPayload: ajv.compile(knowledgeStaleDetectedEventPayloadSchema),
  writingContract: ajv.compile(writingContractSchema),
  writingEvaluation: ajv.compile(writingEvaluationSchema),
  writingPublicationPermit: ajv.compile(writingPublicationPermitSchema),
  verificationSuite: ajv.compile(verificationSuiteSchema),
  verificationResult: ajv.compile(verificationResultSchema),
  verificationStartedEventPayload: ajv.compile(verificationStartedEventPayloadSchema),
  verificationCompletedEventPayload: ajv.compile(verificationCompletedEventPayloadSchema),
} satisfies Record<string, ValidateFunction>;

export type SchemaName = keyof typeof validators;

export type ValidationResult =
  { valid: true; errors: [] } | { valid: false; errors: ErrorObject[] };

export function validateSchema(name: SchemaName, value: unknown): ValidationResult {
  const validator = validators[name];
  if (validator(value)) {
    return { valid: true, errors: [] };
  }

  return {
    valid: false,
    errors: validator.errors ? [...validator.errors] : [],
  };
}
