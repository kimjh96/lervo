import {
  validateSchema,
  type AgentContextHandoffRecordedEventPayload,
  type AgentContextPromotedEventPayload,
  type AssignmentCompletionPreparedEventPayload,
  type AssignmentCompletionReconciledEventPayload,
  type ConversationRepositoryWorkCompletedEventPayload,
  type DeliberationArtifactRecordedEventPayload,
  type EventType,
  type KnowledgeCandidateCreatedEventPayload,
  type KnowledgeCandidateReviewedEventPayload,
  type KnowledgeReconciliationReviewedEventPayload,
  type KnowledgeStaleDetectedEventPayload,
  type KnowledgeVerifiedEventPayload,
  type RunCompletedEventPayload,
  type ResourceUsageRecordedEventPayload,
  type SchemaName,
  type VerificationCompletedEventPayload,
  type WorkstreamSnapshotRecordedEventPayload,
} from "@lervo/schemas";
import { supervisionPayloadAllowlists, validateSupervisionPayload } from "./supervision-payload.js";
import { roleInputPayloadFields, validateRoleInputPayload } from "./role-input-payload.js";
import { validateTopologyPolicyPayload } from "./topology-policy-payload.js";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const eventPayloadAllowlists = {
  "managed.execution.reserved": ["executionKey", "requestHash"],
  "role.input.bound": roleInputPayloadFields,
  ...supervisionPayloadAllowlists,
  "run.requested": ["requestDigest", "role", "risk"],
  "run.resolved": ["role", "risk", "policyVersion"],
  "run.completed": ["resultDigest", "artifactIds", "verificationStatus"],
  "run.failed": ["failureCode", "retryable", "diagnosticDigest"],
  "conversation.repository_work.completed": [
    "sourceConversationEventId",
    "workerAgentId",
    "providerSessionDigest",
    "requestedModel",
    "requestedReasoningEffort",
    "executionProfile",
    "allocationReason",
    "requestContentHash",
    "resultContentHash",
    "resultByteCount",
    "repositoryRevisionBefore",
    "repositoryRevisionAfter",
    "changedPaths",
    "changedPathCount",
    "workstreamId",
    "workstreamRevision",
    "workstreamSnapshotHash",
    "knowledgeDisposition",
    "checkpointDisposition",
    "replicaDisposition",
    "verificationStatus",
    "completedAt",
  ],
  "context.recommended": [
    "recommendationId",
    "batchId",
    "sourceAttemptId",
    "engineId",
    "selectionTransitionId",
    "productQualificationId",
    "engineVersion",
    "indexId",
    "resultSetHash",
    "documentId",
    "sourceContentHash",
    "rank",
    "score",
    "selectionPolicyId",
    "selectionPolicyVersion",
    "selectionMaximum",
    "knowledgeContext",
  ],
  "context.selected": [
    "documentId",
    "reasonCode",
    "ruleId",
    "required",
    "scope",
    "knowledgeContext",
  ],
  "document.loaded": [
    "evidenceReceiptId",
    "documentId",
    "contentHash",
    "byteCount",
    "scope",
    "sourceRevision",
    "knowledgeContext",
  ],
  "context.injected": [
    "receiptId",
    "evidenceReceiptIds",
    "envelopeId",
    "documentIds",
    "targetTurnId",
    "contextGeneration",
    "adapterId",
    "providerSessionId",
    "documents",
  ],
  "adapter.result.captured": [
    "adapterId",
    "providerSessionId",
    "targetTurnId",
    "providerTurnId",
    "modelIdentity",
    "resultDigest",
    "byteCount",
    "mediaType",
    "referenceTelemetry",
  ],
  "context.referenced": [
    "evidenceReceiptId",
    "injectedEvidenceReceiptId",
    "adapterReceiptId",
    "sourceEventId",
    "documentId",
    "contentHash",
    "scope",
    "provider",
    "providerSessionId",
    "targetTurnId",
    "providerTurnId",
    "contextGeneration",
    "referenceKind",
    "citation",
  ],
  "context.invalidated": ["documentIds", "reason", "contextGeneration"],
  "context.published": [
    "sharedContextId",
    "documentId",
    "contentHash",
    "producerRoleId",
    "audienceMode",
    "allowedRoleIds",
    "expiresAt",
  ],
  "handoff.created": [
    "handoffId",
    "fromRoleId",
    "toRoleId",
    "sharedContextIds",
    "evidenceEventIds",
    "requestDigest",
  ],
  "agent.registered": [
    "agentId",
    "displayName",
    "displayNameSource",
    "roleId",
    "roleVersion",
    "roleContractHash",
    "roleProfileHash",
    "capabilityHash",
    "provider",
    "parentAgentId",
    "delegationDepth",
  ],
  "agent.identity.changed": [
    "changeKind",
    "agentId",
    "previousDisplayName",
    "displayName",
    "displayNameSource",
    "previousRoleId",
    "previousRoleVersion",
    "previousRoleContractHash",
    "previousRoleProfileHash",
    "roleId",
    "roleVersion",
    "roleContractHash",
    "roleProfileHash",
    "capabilityHash",
    "revision",
  ],
  "agent.status.changed": ["agentId", "previousStatus", "status", "revision"],
  "agent.liveness.observed": [
    "agentId",
    "agentRevision",
    "reportingProvider",
    "providerSessionDigest",
    "observedAt",
  ],
  "provider.process.observed": [
    "adapterId",
    "providerSessionDigest",
    "phase",
    "status",
    "evidence",
    "observedAt",
    "releasesAgentAuthority",
    "releasesAssignmentAuthority",
    "provesWorkProgress",
  ],
  "assignment.created": [
    "assignmentId",
    "taskType",
    "roleId",
    "roleVersion",
    "roleContractHash",
    "requiredCapabilityHash",
    "routineId",
    "routineTemplateVersion",
    "routineTemplateHash",
    "routineInvocationId",
    "routineTriggerKind",
    "routineTriggerDigest",
    "routineNodeKey",
    "topologyContractVersion",
    "topologyChangeId",
    "topologyChangeKey",
    "topologyRequestHash",
    "topologyPlanId",
    "topologyApprovalHash",
    "topologyReviewerIdDigest",
    "topologyExpectedNodeCount",
    "topologyNodeSetHash",
    "topologyNodeKey",
    "topologyPolicyReviewVersion",
    "topologyPolicyDecisionId",
    "topologyPolicyReviewHash",
    "initialStatus",
    "priority",
    "dependencyIds",
    "expectedPathDigest",
    "acceptanceDigest",
    "verificationDigest",
    "approvalDigest",
    "workstreamId",
  ],
  "assignment.claimed": [
    "assignmentId",
    "agentId",
    "leaseId",
    "generation",
    "expiresAt",
    "expectedPathDigest",
  ],
  "assignment.lease.renewed": ["assignmentId", "agentId", "leaseId", "generation", "expiresAt"],
  "assignment.handoff.recorded": [
    "assignmentId",
    "handoffId",
    "fromAgentId",
    "toAgentId",
    "requestDigest",
    "artifactIds",
    "artifactHashes",
    "contextEvidenceEventIds",
    "triggerKind",
    "triggerAdapterId",
    "triggerAdapterVersion",
    "triggerDescriptorHash",
    "triggerSourceEventId",
    "triggerSourceEventKeyHash",
  ],
  "assignment.handoff.acknowledged": [
    "assignmentId",
    "handoffId",
    "recipientAgentId",
    "acknowledgedAt",
    "assignmentRevision",
  ],
  "assignment.cancelled": [
    "assignmentId",
    "previousStatus",
    "reason",
    "planId",
    "cancelledDependencyIds",
    "revision",
  ],
  "assignment.completion.prepared": [
    "completionEvidenceId",
    "workstreamId",
    "assignmentId",
    "assignmentRevision",
    "agentId",
    "leaseId",
    "resultArtifactId",
    "resultContentHash",
    "verificationStatus",
    "writingPublicationStatus",
    "preparedAt",
  ],
  "assignment.completion.reconciled": [
    "completionEvidenceId",
    "reconciliationCommandId",
    "sourceRunId",
    "assignmentId",
    "agentId",
    "leaseId",
    "resultArtifactId",
    "resultContentHash",
    "revision",
    "reconciledAt",
  ],
  "assignment.completed": [
    "assignmentId",
    "agentId",
    "status",
    "verificationStatus",
    "artifactIds",
    "artifactHashes",
    "failureCode",
  ],
  "assignment.role.binding.changed": [
    "assignmentId",
    "previousRoleVersion",
    "previousRoleContractHash",
    "previousRequiredCapabilityHash",
    "roleId",
    "roleVersion",
    "roleContractHash",
    "requiredCapabilityHash",
    "revision",
  ],
  "assignment.amended": [
    "assignmentId",
    "assignmentRevision",
    "assignmentHash",
    "predecessorAssignmentHash",
    "predecessorResponsibilityHash",
    "successorResponsibilityHash",
  ],
  "assignment.reopened": [
    "assignmentId",
    "assignmentRevision",
    "assignmentHash",
    "kind",
    "predecessorAssignmentHash",
    "responsibilityHash",
    "sourceRunId",
    "terminalEventId",
    "reviewEventId",
    "attemptNumber",
    "predecessorLeaseGeneration",
  ],
  "public_readme.improvement.applied": [
    "operation",
    "planId",
    "operationId",
    "sourceHash",
    "outputHash",
    "profileId",
    "language",
    "audienceDigest",
    "intentDigest",
    "protectedCoordinateDigest",
    "protectedCoordinateCount",
    "changedCoordinateCount",
    "approvalHash",
    "appliedAt",
  ],
  "adapter.started": [
    "adapterId",
    "adapterVersion",
    "providerSessionId",
    "executionMode",
    "capabilities",
  ],
  "adapter.stopped": ["adapterId", "providerSessionId", "status"],
  "capability.requested": ["capability", "targetDigest", "risk"],
  "capability.decided": ["capability", "decision", "policyRuleId", "approvalId"],
  "capability.activated": [
    "capabilityId",
    "capabilityKind",
    "version",
    "contentHash",
    "adapterId",
    "providerSessionId",
    "evidence",
    "activationDigest",
  ],
  "capability.recommended": [
    "capabilityId",
    "capabilityKind",
    "version",
    "contentHash",
    "score",
    "reasonCodes",
    "queryDigest",
  ],
  "capability.selected": ["capabilityId", "capabilityKind", "version", "contentHash", "reason"],
  "capability.loaded": [
    "capabilityId",
    "capabilityKind",
    "version",
    "contentHash",
    "sourceKind",
    "validationDigest",
  ],
  "capability.invoked": [
    "capabilityId",
    "capabilityKind",
    "version",
    "contentHash",
    "providerItemDigest",
    "inputDigest",
  ],
  "capability.completed": [
    "capabilityId",
    "capabilityKind",
    "version",
    "contentHash",
    "providerItemDigest",
    "status",
    "durationMs",
  ],
  "tool.called": ["toolName", "inputDigest", "status", "durationMs"],
  "command.executed": [
    "commandDigest",
    "cwdRelative",
    "status",
    "exitCode",
    "outputDigest",
    "durationMs",
  ],
  "file.changed": ["path", "beforeHash", "afterHash", "changeKind"],
  "skill.resolved": ["skillId", "source", "version", "contentHash", "trustStatus"],
  "skill.invoked": ["skillId", "version", "inputDigest", "capabilities"],
  "skill.completed": ["skillId", "version", "status", "artifactIds", "outputDigest"],
  "verification.started": ["suiteId", "suiteHash", "repositoryRevision"],
  "verification.completed": [
    "verificationId",
    "suiteId",
    "suiteHash",
    "repositoryRevision",
    "status",
    "resultArtifactId",
    "resultContentHash",
    "nonPassedCommandIds",
  ],
  "deliberation.started": [
    "deliberationId",
    "policyId",
    "policyHash",
    "participantRoleIds",
    "maxRounds",
    "policy",
  ],
  "deliberation.artifact.recorded": [
    "deliberationId",
    "deliberationArtifactId",
    "kind",
    "round",
    "producerRoleId",
    "producerRoleName",
    "artifactId",
    "contentHash",
    "writingPermitId",
    "artifact",
  ],
  "deliberation.artifact.publication_failed": [
    "deliberationId",
    "kind",
    "round",
    "producerRoleId",
    "producerProvider",
    "semanticEvaluatorProvider",
    "attempt",
    "artifactId",
    "contentHash",
    "repositoryVerificationStatus",
    "writingPublicationStatus",
    "recoveryStatus",
    "failureReason",
    "failedChecks",
    "missingChecks",
    "semanticEvaluationStatus",
    "repairAttemptLimit",
  ],
  "deliberation.completed": [
    "deliberationId",
    "outcomeId",
    "status",
    "lastRound",
    "decisionArtifactId",
    "unresolvedBlockingObjectionIds",
    "failurePhase",
    "failureCode",
  ],
  "development.pattern.observed": [
    "patternId",
    "observationId",
    "provider",
    "sourceSnapshotId",
    "sourceSnapshotHash",
    "evidenceDigest",
    "occurrenceCount",
    "observedAt",
  ],
  "development.pattern.transitioned": [
    "transitionId",
    "patternId",
    "fromState",
    "toState",
    "candidateArtifactId",
    "candidateContentHash",
    "reviewArtifactId",
    "reviewContentHash",
    "supersededByPatternId",
    "targetKind",
    "previousTargetArtifactId",
    "previousTargetContentHash",
    "activatedRoleId",
    "activatedRoleVersion",
    "activatedRoleContractHash",
    "activatedRoleProfileHash",
    "approvalHash",
    "occurredAt",
  ],
  "development.pattern.evaluation.registered": [
    "protocolId",
    "patternId",
    "protocolPlanId",
    "protocolArtifactId",
    "protocolArtifactHash",
    "candidateContentHash",
    "reviewContentHash",
    "targetContentHash",
    "adapterId",
    "adapterVersion",
    "adapterDescriptorHash",
    "baselineWindowHash",
    "baselineObservationHash",
    "metricIds",
    "registeredAt",
  ],
  "development.pattern.effect.observed": [
    "comparisonId",
    "patternId",
    "protocolId",
    "comparisonPlanId",
    "comparisonArtifactId",
    "comparisonArtifactHash",
    "registrationEventId",
    "promotionEventId",
    "targetContentHash",
    "adapterId",
    "adapterVersion",
    "adapterDescriptorHash",
    "treatmentWindowHash",
    "treatmentObservationHash",
    "overall",
    "attribution",
    "rollbackDisposition",
    "metricCount",
    "observedAt",
  ],
  "role.profile.activated": [
    "activationId",
    "provider",
    "roleId",
    "roleVersion",
    "roleContractHash",
    "roleProfileHash",
    "runtimeProfileHash",
    "sourceKind",
    "activatedAt",
  ],
  "organization.team.bound": [
    "organizationId",
    "teamId",
    "projectId",
    "repositoryIdentityHash",
    "organizationPolicyHash",
    "teamPolicyHash",
    "teamKind",
    "boundAt",
  ],
  "organization.team.kind.changed": [
    "organizationId",
    "teamId",
    "projectId",
    "repositoryIdentityHash",
    "previousTeamKind",
    "teamKind",
    "revision",
    "changedAt",
  ],
  "organization.agent.membership.changed": [
    "membershipId",
    "organizationId",
    "teamId",
    "projectId",
    "agentId",
    "agentDisplayName",
    "agentDisplayNameSource",
    "displayNameRevision",
    "roleId",
    "roleVersion",
    "roleContractHash",
    "roleProfileHash",
    "providerPolicyHash",
    "previousStatus",
    "status",
    "revision",
    "changedAt",
  ],
  "organization.agent.identity.changed": [
    "membershipId",
    "organizationId",
    "teamId",
    "projectId",
    "agentId",
    "previousDisplayName",
    "displayName",
    "displayNameSource",
    "revision",
    "changedAt",
  ],
  "organization.external_agent.deployment.bound": [
    "deploymentId",
    "organizationId",
    "teamId",
    "projectId",
    "membershipId",
    "agentId",
    "agentDisplayName",
    "agentDisplayNameSource",
    "displayNameRevision",
    "participantId",
    "roleId",
    "roleVersion",
    "roleContractHash",
    "roleProfileHash",
    "providerPolicyHash",
    "platform",
    "integrationId",
    "externalPrincipalHash",
    "deploymentConfigHash",
    "boundAt",
  ],
  "organization.external_agent.deployment.retired": [
    "deploymentId",
    "organizationId",
    "teamId",
    "projectId",
    "membershipId",
    "agentId",
    "reasonCode",
    "retiredAt",
  ],
  "organization.channel.membership.changed": [
    "channelMembershipId",
    "deploymentId",
    "organizationId",
    "teamId",
    "projectId",
    "membershipId",
    "agentId",
    "participantId",
    "platform",
    "integrationId",
    "tenantKeyHash",
    "conversationKeyHash",
    "conversationId",
    "previousStatus",
    "status",
    "revision",
    "changedAt",
  ],
  "organization.deliberation.participant.bound": [
    "deliberationId",
    "deliberationPolicyHash",
    "bindingVersion",
    "participationAssignmentId",
    "policyId",
    "organizationId",
    "teamId",
    "projectId",
    "channelMembershipId",
    "membershipId",
    "deploymentId",
    "agentId",
    "participantId",
    "roleId",
    "policyRoleId",
    "agentRoleId",
    "roleVersion",
    "roleContractHash",
    "roleProfileHash",
    "providerPolicyHash",
    "executionRouteHash",
    "executionProvider",
    "acceptedAt",
    "boundAt",
  ],
  "organization.deliberation.participant.released": [
    "deliberationId",
    "organizationId",
    "teamId",
    "projectId",
    "agentId",
    "participantId",
    "outcomeId",
    "status",
    "releasedAt",
  ],
  "agent.context.promoted": [
    "contextEntryId",
    "agentId",
    "layer",
    "memoryKind",
    "subjectKey",
    "audience",
    "sensitivity",
    "confidence",
    "retrievalDigests",
    "observedAt",
    "expiresAt",
    "reviewBindingVersion",
    "source",
    "summaryArtifactId",
    "summaryContentHash",
    "summaryByteCount",
    "reviewEventId",
    "reviewEventHash",
    "supersedesContextEntryId",
    "promotedAt",
  ],
  "agent.context.handoff.recorded": [
    "contextHandoffId",
    "fromAgentId",
    "toAgentId",
    "contextEntryIds",
    "manifestArtifactId",
    "manifestContentHash",
    "manifestByteCount",
    "recordedAt",
  ],
  "knowledge.candidate.created": [
    "candidateId",
    "claimDigest",
    "paths",
    "evidenceIds",
    "sourceOutcomeId",
    "decisionArtifactId",
    "verificationArtifactIds",
    "verifiedRevision",
    "candidateArtifactId",
    "candidateContentHash",
  ],
  "knowledge.candidate.reviewed": [
    "candidateId",
    "candidateContentHash",
    "approvalId",
    "approvalArtifactId",
    "approvalContentHash",
    "decision",
    "policyId",
    "policyVersion",
    "itemApprovalDigest",
    "repositoryRevision",
    "resolvedConflictCandidateIds",
  ],
  "knowledge.reconciliation.reviewed": [
    "compilationId",
    "candidateArtifactHash",
    "reconciliationPlanId",
    "sourceSnapshotId",
    "repositoryRevision",
    "registryDigest",
    "reviewId",
    "reviewArtifactId",
    "reviewArtifactHash",
    "decision",
    "policyId",
    "policyVersion",
    "itemApprovalDigest",
    "acceptedDispositionIds",
    "skippedDispositionIds",
    "dispositionListTruncated",
    "dispositionCount",
    "reviewedAt",
  ],
  "knowledge.verified": [
    "knowledgeId",
    "candidateId",
    "candidateContentHash",
    "approvalId",
    "approvalContentHash",
    "claimDigest",
    "paths",
    "verifiedRevision",
    "knowledgeArtifactId",
    "knowledgeContentHash",
  ],
  "knowledge.stale.detected": [
    "knowledgeId",
    "resultId",
    "verifiedRevision",
    "currentRevision",
    "reasons",
    "changedPaths",
    "missingPaths",
    "resultArtifactId",
    "resultContentHash",
  ],
  "knowledge.materialization.applied": [
    "operation",
    "planId",
    "sourceSnapshotId",
    "policyHash",
    "compilerId",
    "compilerVersion",
    "compilerBuildId",
    "approvalDigest",
    "coverage",
    "bundleIds",
    "createdConceptIds",
    "updatedConceptIds",
    "deprecatedConceptIds",
    "conceptListTruncated",
    "resultArtifactId",
    "resultArtifactHash",
    "createdCount",
    "updatedCount",
    "unchangedCount",
    "deletedCount",
    "beforeRegistryDigest",
    "afterRegistryDigest",
    "validationReportId",
    "validationReportHash",
    "appliedAt",
  ],
  "state.pruned": [
    "planId",
    "policyHash",
    "inventoryDigest",
    "removedFiles",
    "removedBytes",
    "classCounts",
    "appliedAt",
  ],
  "terminal.integration.applied": [
    "operation",
    "planId",
    "contractId",
    "providers",
    "targetPathDigests",
    "targetAfterHashes",
    "runtimePathDigest",
    "runtimeAfterHash",
    "approvalHash",
    "appliedAt",
  ],
  "terminal.context.prepared": [
    "observationId",
    "executionMode",
    "providerSessionDigest",
    "providerTurnDigest",
    "sourceSnapshotId",
    "repositoryRevision",
    "requestDigest",
    "queryDigest",
    "queryProjectionReceipt",
    "groundingStatus",
    "groundingWorkflowId",
    "groundingSourceClasses",
    "groundingSubjectIds",
    "groundingProviderIds",
    "groundingReasons",
    "durableInstructionStatus",
    "durableInstructionRuleId",
    "durableInstructionTargetPath",
    "durableInstructionReasonIds",
    "selectionStatus",
    "loadingStatus",
    "hookPreparationStatus",
    "providerInjectionStatus",
    "providerUseStatus",
    "contextHash",
    "recommendationCount",
    "loadedDocuments",
    "workstreamId",
    "workstreamRevision",
    "workstreamSnapshotHash",
    "workstreamScope",
    "workstreamDeliveredByteCount",
    "workspaceExecutionKind",
    "workspaceId",
    "workspaceGeneration",
    "workspaceRevision",
    "assignmentId",
    "leaseGeneration",
    "writerSessionId",
  ],
  "terminal.turn.declared": [
    "declarationId",
    "contextEventId",
    "repositoryRevision",
    "taskMode",
    "canonicalizationDisposition",
    "knowledgeDisposition",
    "deliberationDisposition",
    "deliberationId",
    "declaredAt",
  ],
  "terminal.reference.observed": [
    "observationId",
    "contextEventId",
    "conceptId",
    "path",
    "contentHash",
    "scope",
    "referenceKind",
    "providerSessionDigest",
    "providerTurnDigest",
  ],
  "terminal.turn.observed": [
    "observationId",
    "contextEventId",
    "referenceEventIds",
    "referenceCount",
    "referenceTelemetry",
    "lifecycleStatus",
    "completionResult",
    "repositoryRevisionBefore",
    "repositoryRevisionAfter",
    "repositoryChanged",
    "finalWorkstreamId",
    "finalWorkstreamRevision",
    "finalWorkstreamSnapshotHash",
    "providerSessionDigest",
    "providerTurnDigest",
    "workspaceExecutionKind",
    "workspaceId",
    "workspaceGeneration",
    "workspaceRevision",
    "assignmentId",
    "leaseGeneration",
    "writerSessionId",
    "workspaceCheckpointEventId",
  ],
  "workstream.snapshot.recorded": [
    "workstreamId",
    "revision",
    "status",
    "changeKind",
    "snapshotArtifactId",
    "snapshotContentHash",
    "previousSnapshotContentHash",
    "sourceArtifactId",
    "sourceContentHash",
    "recordedAt",
  ],
  "document.stale.detected": ["documentId", "reason", "verifiedRevision", "currentRevision"],
  "document.migration.applied": [
    "migrationKind",
    "planId",
    "approvalId",
    "approvalDigest",
    "beforeLayoutHash",
    "afterLayoutHash",
    "sourceHashes",
    "candidateArtifactHashes",
    "sourceRegistryHash",
    "entryArtifactHashes",
    "archiveContentHash",
    "sidecars",
    "appliedAt",
  ],
  "project.identity.migrated": [
    "planId",
    "sourceTreeHash",
    "preservedEventCount",
    "preservedEventHeadHash",
    "verifiedCasObjectCount",
    "documentDisposition",
    "migratedAt",
  ],
  "unmanaged_change.detected": ["paths", "beforeRevision", "afterRevision", "detectedAt"],
  "sync.acknowledged": ["eventIds", "hubId", "acknowledgedAt"],
  "work.causality.recorded": [
    "workId",
    "executionContractVersion",
    "relationship",
    "parentRunId",
    "retryOfRunId",
    "attemptOrdinal",
    "workstreamId",
    "assignmentId",
    "agentId",
  ],
  "resource.usage.recorded": [
    "workId",
    "resourceObservationId",
    "sourceCoordinateDigest",
    "scope",
    "source",
    "accountingMode",
    "accountingDescriptorHash",
    "modelIdentity",
    "status",
    "usage",
    "reasonCode",
  ],
  "execution.stages.observed": [
    "executionMode",
    "workId",
    "terminalObservationId",
    "terminalHook",
    "observationSetId",
    "stageCatalogVersion",
    "environmentProfileDigest",
    "repositoryProfile",
    "stages",
  ],
} as const satisfies Record<EventType, readonly string[]>;

const sensitiveFragments = [
  "authorization",
  "cookie",
  "credential",
  "documentbody",
  "password",
  "prompt",
  "rawcontent",
  "secret",
  "token",
  "apikey",
  "toolinput",
] as const;

const unsafeObjectKeys = new Set(["__proto__", "constructor", "prototype"]);
const safeSensitiveCoordinatePaths = new Set([
  "$.queryProjectionReceipt.usage.inputTokens",
  "$.queryProjectionReceipt.usage.cachedInputTokens",
  "$.queryProjectionReceipt.usage.outputTokens",
  "$.queryProjectionReceipt.usage.reasoningOutputTokens",
  "$.queryProjectionReceipt.usage.totalTokens",
  "$.usage.inputTokens",
  "$.usage.cachedInputTokens",
  "$.usage.outputTokens",
  "$.usage.reasoningOutputTokens",
  "$.usage.totalTokens",
  "$.policy.executionBudget.maximumObservedTokens",
  "$.policy.executionBudget.unobservedTokenDisposition",
]);

export type RedactionErrorCode =
  "cyclic_payload" | "invalid_payload" | "non_finite_number" | "unsupported_value";

export class RedactionError extends Error {
  constructor(
    readonly code: RedactionErrorCode,
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "RedactionError";
  }
}

export interface RedactionRecord {
  path: string;
  reason: "not_allowlisted" | "sensitive_key" | "unsafe_key";
}

export interface SanitizedPayload {
  payload: Record<string, JsonValue>;
  redactions: RedactionRecord[];
}

function normalizedKey(key: string): string {
  return key
    .normalize("NFKC")
    .replace(/[^a-z0-9]/gi, "")
    .toLowerCase();
}

export function isSensitivePayloadKey(key: string): boolean {
  const normalized = normalizedKey(key);
  return sensitiveFragments.some((fragment) => normalized.includes(fragment));
}

function sanitizeNested(
  value: unknown,
  path: string,
  redactions: RedactionRecord[],
  ancestors: WeakSet<object>,
): JsonValue {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new RedactionError("non_finite_number", path, `${path} can store only finite numbers.`);
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") {
    throw new RedactionError(
      "unsupported_value",
      path,
      `A ${typeof value} value at ${path} cannot be stored in an event payload.`,
    );
  }
  if (ancestors.has(value)) {
    throw new RedactionError("cyclic_payload", path, `A cyclic reference was found at ${path}.`);
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item, index) =>
        sanitizeNested(item, `${path}[${index}]`, redactions, ancestors),
      );
    }

    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      throw new RedactionError(
        "unsupported_value",
        path,
        `${path} can store only plain JSON objects.`,
      );
    }
    const output: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
    for (const [key, nestedValue] of Object.entries(value)) {
      const nestedPath = `${path}.${key}`;
      if (unsafeObjectKeys.has(key)) {
        redactions.push({ path: nestedPath, reason: "unsafe_key" });
        continue;
      }
      if (isSensitivePayloadKey(key) && !safeSensitiveCoordinatePaths.has(nestedPath)) {
        redactions.push({ path: nestedPath, reason: "sensitive_key" });
        continue;
      }
      output[key] = sanitizeNested(nestedValue, nestedPath, redactions, ancestors);
    }
    return output;
  } finally {
    ancestors.delete(value);
  }
}

export function sanitizeEventPayload(
  type: EventType,
  payload: Readonly<Record<string, unknown>>,
): SanitizedPayload {
  const allowed = new Set<string>(eventPayloadAllowlists[type]);
  const sanitized: Record<string, JsonValue> = Object.create(null) as Record<string, JsonValue>;
  const redactions: RedactionRecord[] = [];
  const ancestors = new WeakSet<object>();

  for (const [key, value] of Object.entries(payload)) {
    const path = `$.${key}`;
    if (!allowed.has(key)) {
      redactions.push({ path, reason: "not_allowlisted" });
      continue;
    }
    if (unsafeObjectKeys.has(key)) {
      redactions.push({ path, reason: "unsafe_key" });
      continue;
    }
    if (isSensitivePayloadKey(key)) {
      redactions.push({ path, reason: "sensitive_key" });
      continue;
    }
    sanitized[key] = sanitizeNested(value, path, redactions, ancestors);
  }

  try {
    if (
      type === "managed.execution.reserved" &&
      (Object.keys(sanitized).length !== 2 ||
        ![sanitized.executionKey, sanitized.requestHash].every(
          (value) => typeof value === "string" && /^sha256:[a-f0-9]{64}$/u.test(value),
        ))
    )
      throw new TypeError("The managed execution reservation is invalid.");
    validateSupervisionPayload(type, sanitized);
    if (type === "role.input.bound") validateRoleInputPayload(sanitized);
    validateTopologyPolicyPayload(type, sanitized);
  } catch {
    throw new RedactionError("invalid_payload", "$", "The supervision payload is invalid.");
  }
  const schemaName = eventPayloadSchemas[type];
  const invalidSchema = schemaName !== undefined && !validateSchema(schemaName, sanitized).valid;
  const invalidArtifactCoordinate =
    !invalidSchema &&
    type === "deliberation.artifact.recorded" &&
    !deliberationArtifactCoordinateMatches(
      sanitized as unknown as DeliberationArtifactRecordedEventPayload,
    );
  const invalidCandidateCoordinate =
    !invalidSchema &&
    type === "knowledge.candidate.created" &&
    !knowledgeCandidateCoordinateMatches(
      sanitized as unknown as KnowledgeCandidateCreatedEventPayload,
    );
  const invalidKnowledgeCoordinate =
    !invalidSchema &&
    ((type === "knowledge.candidate.reviewed" &&
      !reviewCoordinateMatches(sanitized as unknown as KnowledgeCandidateReviewedEventPayload)) ||
      (type === "knowledge.reconciliation.reviewed" &&
        !reconciliationReviewCoordinateMatches(
          sanitized as unknown as KnowledgeReconciliationReviewedEventPayload,
        )) ||
      (type === "knowledge.verified" &&
        !verifiedCoordinateMatches(sanitized as unknown as KnowledgeVerifiedEventPayload)) ||
      (type === "knowledge.stale.detected" &&
        !staleCoordinateMatches(sanitized as unknown as KnowledgeStaleDetectedEventPayload)));
  const invalidVerificationCoordinate =
    !invalidSchema &&
    type === "verification.completed" &&
    !verificationCoordinateMatches(sanitized as unknown as VerificationCompletedEventPayload);
  const invalidRunCompletedCoordinate =
    !invalidSchema &&
    type === "run.completed" &&
    !runCompletedCoordinateMatches(sanitized as unknown as RunCompletedEventPayload);
  const invalidCompletionPreparedCoordinate =
    !invalidSchema &&
    type === "assignment.completion.prepared" &&
    !assignmentCompletionPreparedCoordinateMatches(
      sanitized as unknown as AssignmentCompletionPreparedEventPayload,
    );
  const invalidConversationRepositoryWorkCoordinate =
    !invalidSchema &&
    type === "conversation.repository_work.completed" &&
    !conversationRepositoryWorkCoordinateMatches(
      sanitized as unknown as ConversationRepositoryWorkCompletedEventPayload,
    );
  const invalidCompletionReconciledCoordinate =
    !invalidSchema &&
    type === "assignment.completion.reconciled" &&
    !assignmentCompletionReconciledCoordinateMatches(
      sanitized as unknown as AssignmentCompletionReconciledEventPayload,
    );
  const invalidWorkstreamCoordinate =
    !invalidSchema &&
    type === "workstream.snapshot.recorded" &&
    !workstreamCoordinateMatches(sanitized as unknown as WorkstreamSnapshotRecordedEventPayload);
  const invalidResourceUsageCoordinate =
    !invalidSchema &&
    type === "resource.usage.recorded" &&
    !resourceUsageCoordinateMatches(sanitized as unknown as ResourceUsageRecordedEventPayload);
  const invalidAgentContextCoordinate =
    !invalidSchema &&
    ((type === "agent.context.promoted" &&
      !agentContextPromotionCoordinateMatches(
        sanitized as unknown as AgentContextPromotedEventPayload,
      )) ||
      (type === "agent.context.handoff.recorded" &&
        !agentContextHandoffCoordinateMatches(
          sanitized as unknown as AgentContextHandoffRecordedEventPayload,
        )));
  if (
    invalidSchema ||
    invalidArtifactCoordinate ||
    invalidCandidateCoordinate ||
    invalidKnowledgeCoordinate ||
    invalidVerificationCoordinate ||
    invalidRunCompletedCoordinate ||
    invalidCompletionPreparedCoordinate ||
    invalidConversationRepositoryWorkCoordinate ||
    invalidCompletionReconciledCoordinate ||
    invalidWorkstreamCoordinate ||
    invalidResourceUsageCoordinate ||
    invalidAgentContextCoordinate
  ) {
    throw new RedactionError(
      "invalid_payload",
      "$",
      `${type} payload does not satisfy the required coordinates and state contract.`,
    );
  }

  return { payload: sanitized, redactions };
}

const eventPayloadSchemas: Partial<Record<EventType, SchemaName>> = {
  "conversation.repository_work.completed": "conversationRepositoryWorkCompletedEventPayload",
  "agent.context.promoted": "agentContextPromotedEventPayload",
  "agent.context.handoff.recorded": "agentContextHandoffRecordedEventPayload",
  "agent.liveness.observed": "agentLivenessObservedEventPayload",
  "provider.process.observed": "providerProcessObservedEventPayload",
  "capability.activated": "capabilityActivatedEventPayload",
  "context.recommended": "contextRecommendationEventPayload",
  "context.injected": "managedContextInjectedEventPayload",
  "adapter.result.captured": "adapterResultCapturedEventPayload",
  "context.referenced": "managedContextReferencedEventPayload",
  "run.completed": "runCompletedEventPayload",
  "assignment.completion.prepared": "assignmentCompletionPreparedEventPayload",
  "assignment.amended": "assignmentAmendedEventPayload",
  "assignment.reopened": "assignmentReopenedEventPayload",
  "assignment.completion.reconciled": "assignmentCompletionReconciledEventPayload",
  "deliberation.started": "deliberationStartedEventPayload",
  "deliberation.artifact.recorded": "deliberationArtifactRecordedEventPayload",
  "deliberation.artifact.publication_failed": "deliberationArtifactPublicationFailedEventPayload",
  "deliberation.completed": "deliberationCompletedEventPayload",
  "development.pattern.observed": "developmentPatternObservedEventPayload",
  "development.pattern.transitioned": "developmentPatternTransitionedEventPayload",
  "development.pattern.evaluation.registered": "developmentPatternEvaluationRegisteredEventPayload",
  "development.pattern.effect.observed": "developmentPatternEffectObservedEventPayload",
  "role.profile.activated": "roleProfileActivatedEventPayload",
  "organization.team.bound": "organizationTeamBoundEventPayload",
  "organization.team.kind.changed": "organizationTeamKindChangedEventPayload",
  "organization.agent.membership.changed": "organizationAgentMembershipChangedEventPayload",
  "organization.agent.identity.changed": "organizationAgentIdentityChangedEventPayload",
  "organization.external_agent.deployment.bound":
    "organizationExternalAgentDeploymentBoundEventPayload",
  "organization.external_agent.deployment.retired":
    "organizationExternalAgentDeploymentRetiredEventPayload",
  "organization.channel.membership.changed": "organizationChannelMembershipChangedEventPayload",
  "organization.deliberation.participant.bound":
    "organizationDeliberationParticipantBoundEventPayload",
  "organization.deliberation.participant.released":
    "organizationDeliberationParticipantReleasedEventPayload",
  "knowledge.candidate.created": "knowledgeCandidateCreatedEventPayload",
  "knowledge.candidate.reviewed": "knowledgeCandidateReviewedEventPayload",
  "knowledge.reconciliation.reviewed": "knowledgeReconciliationReviewedEventPayload",
  "knowledge.verified": "knowledgeVerifiedEventPayload",
  "knowledge.stale.detected": "knowledgeStaleDetectedEventPayload",
  "verification.started": "verificationStartedEventPayload",
  "verification.completed": "verificationCompletedEventPayload",
  "project.identity.migrated": "projectIdentityMigratedEventPayload",
  "state.pruned": "statePrunedEventPayload",
  "terminal.context.prepared": "terminalContextPreparedEventPayload",
  "terminal.turn.declared": "terminalTurnDeclaredEventPayload",
  "terminal.reference.observed": "terminalReferenceObservedEventPayload",
  "terminal.turn.observed": "terminalTurnObservedEventPayload",
  "workstream.snapshot.recorded": "workstreamSnapshotRecordedEventPayload",
  "work.causality.recorded": "workCausalityRecordedEventPayload",
  "resource.usage.recorded": "resourceUsageRecordedEventPayload",
  "execution.stages.observed": "executionStagesObservedEventPayload",
};

function conversationRepositoryWorkCoordinateMatches(
  payload: ConversationRepositoryWorkCompletedEventPayload,
): boolean {
  if (payload.changedPathCount < payload.changedPaths.length) return false;
  return payload.changedPathCount === 0
    ? payload.changedPaths.length === 0 &&
        payload.repositoryRevisionBefore === payload.repositoryRevisionAfter
    : payload.repositoryRevisionBefore !== payload.repositoryRevisionAfter;
}

function deliberationArtifactCoordinateMatches(
  payload: DeliberationArtifactRecordedEventPayload,
): boolean {
  if (payload.artifactId !== `art_${payload.contentHash.slice("sha256:".length)}`) return false;
  const artifact = payload.artifact;
  return (
    artifact === undefined ||
    (artifact.deliberationId === payload.deliberationId &&
      artifact.deliberationArtifactId === payload.deliberationArtifactId &&
      artifact.kind === payload.kind &&
      artifact.round === payload.round &&
      artifact.producer.roleId === payload.producerRoleId &&
      artifact.content.artifactId === payload.artifactId &&
      artifact.content.contentHash === payload.contentHash &&
      artifact.writingPublicationPermit.permitId === payload.writingPermitId)
  );
}

function agentContextPromotionCoordinateMatches(
  payload: AgentContextPromotedEventPayload,
): boolean {
  return (
    payload.summaryArtifactId === `art_${payload.summaryContentHash.slice("sha256:".length)}` &&
    (payload.source.kind !== "artifact" ||
      payload.source.sourceId === `art_${payload.source.contentHash.slice("sha256:".length)}`)
  );
}

function agentContextHandoffCoordinateMatches(
  payload: AgentContextHandoffRecordedEventPayload,
): boolean {
  return (
    payload.manifestArtifactId === `art_${payload.manifestContentHash.slice("sha256:".length)}`
  );
}

function knowledgeCandidateCoordinateMatches(
  payload: KnowledgeCandidateCreatedEventPayload,
): boolean {
  return (
    payload.candidateArtifactId === `art_${payload.candidateContentHash.slice("sha256:".length)}`
  );
}

function workstreamCoordinateMatches(payload: WorkstreamSnapshotRecordedEventPayload): boolean {
  return (
    payload.snapshotArtifactId === `art_${payload.snapshotContentHash.slice("sha256:".length)}` &&
    (payload.sourceArtifactId === null
      ? payload.sourceContentHash === null
      : payload.sourceContentHash !== null &&
        payload.sourceArtifactId === `art_${payload.sourceContentHash.slice("sha256:".length)}`) &&
    (["legacy_handoff_migration", "legacy_continuation_migration"].includes(payload.changeKind)
      ? payload.sourceArtifactId !== null && payload.sourceContentHash !== null
      : payload.sourceArtifactId === null && payload.sourceContentHash === null)
  );
}

function reviewCoordinateMatches(payload: KnowledgeCandidateReviewedEventPayload): boolean {
  return (
    payload.approvalArtifactId === `art_${payload.approvalContentHash.slice("sha256:".length)}`
  );
}

function reconciliationReviewCoordinateMatches(
  payload: KnowledgeReconciliationReviewedEventPayload,
): boolean {
  const accepted = new Set(payload.acceptedDispositionIds);
  const listedCount = payload.acceptedDispositionIds.length + payload.skippedDispositionIds.length;
  return (
    payload.reviewArtifactId === `art_${payload.reviewArtifactHash.slice("sha256:".length)}` &&
    payload.skippedDispositionIds.every((id) => !accepted.has(id)) &&
    listedCount <= 256 &&
    payload.dispositionCount >= listedCount &&
    payload.dispositionListTruncated === payload.dispositionCount > listedCount &&
    (payload.decision === "approved"
      ? payload.acceptedDispositionIds.length > 0
      : payload.acceptedDispositionIds.length === 0)
  );
}

function verifiedCoordinateMatches(payload: KnowledgeVerifiedEventPayload): boolean {
  return (
    payload.knowledgeArtifactId === `art_${payload.knowledgeContentHash.slice("sha256:".length)}`
  );
}

function staleCoordinateMatches(payload: KnowledgeStaleDetectedEventPayload): boolean {
  return payload.resultArtifactId === `art_${payload.resultContentHash.slice("sha256:".length)}`;
}

function verificationCoordinateMatches(payload: VerificationCompletedEventPayload): boolean {
  return payload.resultArtifactId === `art_${payload.resultContentHash.slice("sha256:".length)}`;
}

function runCompletedCoordinateMatches(payload: RunCompletedEventPayload): boolean {
  const resultArtifactId = `art_${payload.resultDigest.slice("sha256:".length)}`;
  return (
    payload.artifactIds.includes(resultArtifactId) &&
    (payload.verificationStatus === "not_run"
      ? payload.artifactIds.length === 1
      : payload.artifactIds.length >= 2)
  );
}

function assignmentCompletionPreparedCoordinateMatches(
  payload: AssignmentCompletionPreparedEventPayload,
): boolean {
  return payload.resultArtifactId === `art_${payload.resultContentHash.slice("sha256:".length)}`;
}

function assignmentCompletionReconciledCoordinateMatches(
  payload: AssignmentCompletionReconciledEventPayload,
): boolean {
  return payload.resultArtifactId === `art_${payload.resultContentHash.slice("sha256:".length)}`;
}

function resourceUsageCoordinateMatches(payload: ResourceUsageRecordedEventPayload): boolean {
  return (
    payload.usage === null ||
    (payload.usage.cachedInputTokens <= payload.usage.inputTokens &&
      payload.usage.reasoningOutputTokens <= payload.usage.outputTokens &&
      payload.usage.totalTokens === payload.usage.inputTokens + payload.usage.outputTokens)
  );
}
