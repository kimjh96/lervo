function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function hasNativeSessionArms(contract) {
  const codex = contract.providers.arms.find((arm) => arm.provider === "codex");
  const claude = contract.providers.arms.find((arm) => arm.provider === "claude");
  return (
    contract.credentials.userApiKeysRequired === false &&
    codex?.model === "gpt-5.6-sol" &&
    codex.taskTransport === "provider_native_signed_in_session" &&
    claude?.model === "opus" &&
    claude.taskTransport === "provider_native_signed_in_session"
  );
}

function hasDeterministicSelection(contract) {
  return (
    contract.selection.kind === "deterministic_all_current_linked_candidates_v1" &&
    contract.selection.policyDigest ===
      "sha256:8063ff4d0c1825b3abe35f81a53f245b988b8c6ea1e0cdacf2a690bbea76cb18"
  );
}

function validateV6(contract) {
  assert(
    contract.preparation.workstreamRevision === 231 &&
      contract.preparation.workstreamTitle ===
        "Execute and measure exact key-free managed canary v5" &&
      hasDeterministicSelection(contract) &&
      contract.selection.policyId === "managed-linked-evidence-all-candidates-v1" &&
      contract.preparationPredecessor.checkpointId ===
        "linked-evidence-managed-canary-v5-native-session-20260829" &&
      contract.preparationPredecessor.preparedManifestDigest ===
        "sha256:85a22b76aa5a07ab58e66eb58035cedbd64b83780b8c356b6cc835f1c90d8f02" &&
      contract.preparationPredecessor.providerCalls === 0 &&
      contract.preparationPredecessor.nonemptySelectionRuns === 16 &&
      contract.runtime.selectionAdapterCreationsPerRun === 0 &&
      contract.runtime.canaryRecordSchemaVersion === 2 &&
      contract.credentials.optionalByokSelectionTransportInPrimaryPath === false &&
      hasNativeSessionArms(contract) &&
      !contract.providers.arms.some((arm) => "selectionTransport" in arm),
    "The managed canary v6 checkpoint violates the exact execution-operation binding.",
  );
}

function validateV7(contract) {
  assert(
    contract.preparation.workstreamRevision === 231 &&
      hasDeterministicSelection(contract) &&
      contract.task.roleId === "developer" &&
      contract.preparationPredecessor.checkpointId ===
        "linked-evidence-managed-canary-v6-native-session-20260829" &&
      contract.preparationPredecessor.preparedManifestDigest ===
        "sha256:313b5406f7206d1ea8033fd5c13d0939e71eecf88e78382ac0dfde3118f0da97" &&
      contract.preparationPredecessor.terminallyStoppedAfterPreProviderValidation === true &&
      contract.preparationPredecessor.conservativeAttemptedTaskCalls === 1 &&
      contract.preparationPredecessor.providerUsageObserved === false &&
      contract.preparationPredecessor.failureObservationFileDigest ===
        "sha256:0b44394ee871d684712cb4fe6c0dcceaa69a6fa0b16541696fcdb5631f5a4b67" &&
      hasNativeSessionArms(contract),
    "The managed canary v7 checkpoint violates the machine-output role or v6 terminal binding.",
  );
}

function validateV8(contract) {
  assert(
    contract.preparation.workstreamRevision === 232 &&
      contract.preparation.workstreamTitle === "Complete key-free Codex-Claude managed canary v8" &&
      hasDeterministicSelection(contract) &&
      contract.task.roleId === "canary-researcher" &&
      contract.preparationPredecessor.checkpointId ===
        "linked-evidence-managed-canary-v7-native-session-20260829" &&
      contract.preparationPredecessor.preparedManifestDigest ===
        "sha256:e4b76d1173cb819e0105644cf67a1724b98264ac70c23f7ac566aaa16d43ba4e" &&
      contract.preparationPredecessor.terminallyStoppedDuringAdapterStart === true &&
      contract.preparationPredecessor.conservativeAttemptedTaskCalls === 1 &&
      contract.preparationPredecessor.providerClientCreated === false &&
      contract.preparationPredecessor.providerUsageObserved === false &&
      contract.preparationPredecessor.failureObservationFileDigest ===
        "sha256:d7c679111af964a6277e2df52f6f9798222fab09d26b233af79a1147b91ec821" &&
      hasNativeSessionArms(contract),
    "The managed canary v8 checkpoint violates the read-only role or v7 terminal binding.",
  );
}

function validateV9(contract) {
  assert(
    contract.preparation.workstreamRevision === 233 &&
      hasDeterministicSelection(contract) &&
      contract.task.roleId === "canary-researcher" &&
      contract.runtime.nativeTaskUsesRuntimeClock === true &&
      contract.preparationPredecessor.checkpointId ===
        "linked-evidence-managed-canary-v8-native-session-20260829" &&
      contract.preparationPredecessor.preparedManifestDigest ===
        "sha256:610bfea5a0b76b7481715744efaff6fc1b3365d387603846ffc74e8051cbeeca" &&
      contract.preparationPredecessor.terminallyStoppedDuringContextPreparation === true &&
      contract.preparationPredecessor.conservativeAttemptedTaskCalls === 1 &&
      contract.preparationPredecessor.providerClientCreated === true &&
      contract.preparationPredecessor.modelTurnStarted === false &&
      contract.preparationPredecessor.providerUsageObserved === false &&
      contract.preparationPredecessor.failureObservationFileDigest ===
        "sha256:279fa3c0cfb700189e136596f6bc9e146df26b35fe395f46e7dc625947c3c245" &&
      hasNativeSessionArms(contract),
    "The managed canary v9 checkpoint violates the shared-clock or v8 terminal binding.",
  );
}

function validateV10(contract) {
  assert(
    contract.preparation.workstreamRevision === 234 &&
      hasDeterministicSelection(contract) &&
      contract.task.roleId === "canary-researcher" &&
      contract.runtime.manifestBoundClockEarlierThanRuntime === true &&
      contract.preparationPredecessor.checkpointId ===
        "linked-evidence-managed-canary-v9-native-session-20260829" &&
      contract.preparationPredecessor.preparedManifestDigest ===
        "sha256:b87d4b6769c0f9e4e3248ff19846c0154b6cac461f52bdf5615d696ad6dc1d47" &&
      contract.preparationPredecessor.terminallyStoppedBeforeAdapterCreation === true &&
      contract.preparationPredecessor.conservativeAttemptedTaskCalls === 0 &&
      contract.preparationPredecessor.providerClientCreated === false &&
      contract.preparationPredecessor.modelTurnStarted === false &&
      contract.preparationPredecessor.providerUsageObserved === false &&
      contract.preparationPredecessor.failureObservationFileDigest ===
        "sha256:8056970902a4113d5f7b3337cfa454ea968fca808a852d44bf6fe5509620711f" &&
      hasNativeSessionArms(contract),
    "The managed canary v10 checkpoint violates the past manifest-clock or v9 terminal binding.",
  );
}

function validateV11(contract) {
  assert(
    contract.preparation.workstreamRevision === 235 &&
      contract.preparation.workstreamTitle ===
        "Complete key-free Codex-Claude managed canary v11" &&
      hasDeterministicSelection(contract) &&
      contract.task.roleId === "canary-researcher" &&
      contract.runtime.manifestBoundClockEarlierThanRuntime === true &&
      contract.runtime.linkedEvidenceSelectionsForwardedThroughPrepareContext === true &&
      contract.preparationPredecessor.checkpointId ===
        "linked-evidence-managed-canary-v10-native-session-20260829" &&
      contract.preparationPredecessor.preparedManifestDigest ===
        "sha256:934aece6c2eea2798896cf2376c94cf3b31d5b7c64b5f62dd3a7e3a230d231a9" &&
      contract.preparationPredecessor.terminallyStoppedAfterModelTurn === true &&
      contract.preparationPredecessor.conservativeAttemptedTaskCalls === 1 &&
      contract.preparationPredecessor.providerClientCreated === true &&
      contract.preparationPredecessor.modelTurnStarted === true &&
      contract.preparationPredecessor.modelTurnCompleted === true &&
      contract.preparationPredecessor.providerUsageObserved === true &&
      contract.preparationPredecessor.completionEvidenceRejected === true &&
      contract.preparationPredecessor.failureObservationFileDigest ===
        "sha256:4ee1f072208f36ac0d3692e5143a6912c61425ebb9d17758912132198cca49d5" &&
      hasNativeSessionArms(contract),
    "The managed canary v11 checkpoint violates the linked-selection forwarding or v10 terminal binding.",
  );
}

function validateV12(contract) {
  assert(
    contract.preparation.workstreamRevision === 238 &&
      contract.preparation.workstreamTitle ===
        "Constrain E4 references and confirm managed canary v12" &&
      hasDeterministicSelection(contract) &&
      contract.task.roleId === "canary-researcher" &&
      contract.runtime.manifestBoundClockEarlierThanRuntime === true &&
      contract.runtime.linkedEvidenceSelectionsForwardedThroughPrepareContext === true &&
      contract.runtime.providerNeutralReferenceInstructionDigest ===
        "sha256:84e77840809a3a078066a8961e1d5a06e8620790e44f234abf5cee9f681a4a0f" &&
      contract.runtime.referenceObservationPolicy ===
        "record_exact_current_tokens_from_raw_provider_output_without_ground_truth_filtering" &&
      contract.preparationPredecessor.checkpointId ===
        "linked-evidence-managed-canary-v11-native-session-20260829" &&
      contract.preparationPredecessor.preparedManifestDigest ===
        "sha256:c7e31ff9ba22a7e0516fa383c6705c092b4e3f288004771d7a6da874afa282bc" &&
      contract.preparationPredecessor.observationSetDigest ===
        "sha256:5c45338a70bba8ce728dff0af0c7cc71fcbfe2ccaba5cfe823e613b4756b2f9d" &&
      contract.preparationPredecessor.completedRuns === 16 &&
      contract.preparationPredecessor.technicalFailures === 0 &&
      contract.preparationPredecessor.providerCalls === 16 &&
      contract.preparationPredecessor.selectionCalls === 0 &&
      contract.preparationPredecessor.claudePerRunPrecisionFailures === 3 &&
      contract.preparationPredecessor.activationBlocked === true &&
      hasNativeSessionArms(contract),
    "The managed canary v12 checkpoint violates the E4 constraint or v11 terminal binding.",
  );
}

function validateV13(contract) {
  assert(
    contract.preparation.workstreamRevision === 242 &&
      contract.preparation.workstreamTitle === "Prepare typed managed canary v13" &&
      hasDeterministicSelection(contract) &&
      contract.task.roleId === "canary-researcher" &&
      contract.runtime.manifestBoundClockEarlierThanRuntime === true &&
      contract.runtime.linkedEvidenceSelectionsForwardedThroughPrepareContext === true &&
      contract.runtime.documentRoleContract.id === "managed-context-document-role-v1" &&
      contract.runtime.documentRoleContract.taskEvidenceRole === "task_evidence" &&
      contract.runtime.documentRoleContract.governanceContextRole === "governance_context" &&
      contract.runtime.documentRoleContract.governanceEvidenceToken === null &&
      contract.runtime.documentRoleContract.governanceWinsDualClassification === true &&
      contract.runtime.providerNeutralReferenceInstructionDigest ===
        "sha256:8609da28861542c1542373a9eafb20f77a2a18c51c3f9f92bb2a950c02e41227" &&
      contract.runtime.referenceObservationPolicy ===
        "record_exact_current_tokens_from_raw_provider_output_without_ground_truth_filtering" &&
      contract.measurementPredecessor.checkpointId ===
        "linked-evidence-managed-canary-v12-native-session-20260829" &&
      contract.measurementPredecessor.preparedManifestDigest ===
        "sha256:428bb356f2a51d5c2321af454ad451310fd6c6e1e35769fa34c6f4cbd26b35b0" &&
      contract.measurementPredecessor.observationSetDigest ===
        "sha256:5d746c18c28182a71e22234d16eeff936b49b63e3cb32bbe93389e377812be9c" &&
      contract.measurementPredecessor.completedRuns === 16 &&
      contract.measurementPredecessor.technicalFailures === 0 &&
      contract.measurementPredecessor.providerCalls === 16 &&
      contract.measurementPredecessor.selectionCalls === 0 &&
      contract.measurementPredecessor.promptOnlyConstraintRejected === true &&
      contract.measurementPredecessor.rolledBack === true &&
      contract.measurementPredecessor.activationBlocked === true &&
      contract.authorization.operatorAuthority === "not_requested" &&
      hasNativeSessionArms(contract),
    "The managed canary v13 checkpoint violates the typed context or v12 rollback binding.",
  );
}

function validateV14(contract) {
  assert(
    contract.preparation.workstreamRevision === 244 &&
      contract.preparation.workstreamTitle === "Authorize and execute typed managed canary" &&
      hasDeterministicSelection(contract) &&
      contract.task.roleId === "canary-researcher" &&
      contract.runtime.documentRoleContract.id === "managed-context-document-role-v1" &&
      contract.runtime.documentRoleContract.governanceEvidenceToken === null &&
      contract.runtime.referenceObservationPolicy ===
        "record_exact_current_tokens_from_raw_provider_output_without_ground_truth_filtering" &&
      contract.runtime.executionContract.authorizationBinding ===
        "exact_prepared_manifest_digest" &&
      contract.runtime.executionContract.attemptPersistence === "before_provider_call" &&
      contract.runtime.executionContract.sourceBuildRevalidation === "before_every_task" &&
      contract.runtime.executionContract.technicalFailureDisposition ===
        "persist_bounded_failure_and_stop_without_retry" &&
      contract.runtime.executionContract.maximumConcurrentCalls === 1 &&
      contract.preparationPredecessor.checkpointId ===
        "linked-evidence-managed-canary-v13-typed-context-20260829" &&
      contract.preparationPredecessor.preparedManifestDigest ===
        "sha256:37383ba8a8eff8fd327627e392336371fbe2cedffb5a7665c401aa2e9083b3d7" &&
      contract.preparationPredecessor.contractDigest ===
        "sha256:123bf12f49794c45e4e8d14235b2497ea55a94a4a968bbc7f842c91ce8798fd3" &&
      contract.preparationPredecessor.providerCalls === 0 &&
      contract.preparationPredecessor.executionAuthorized === false &&
      contract.preparationPredecessor.managedContextEffectsAuthorized === false &&
      contract.authorization.operatorAuthority ===
        "explicit_user_approval_after_exact_v13_manifest_review" &&
      hasNativeSessionArms(contract),
    "The managed canary v14 checkpoint violates the exact execution or v13 preparation binding.",
  );
}

function validateV15(contract) {
  assert(
    contract.preparation.workstreamRevision === 246 &&
      contract.preparation.workstreamTitle === "Activate claim-eligible managed linked context" &&
      hasDeterministicSelection(contract) &&
      hasNativeSessionArms(contract) &&
      contract.task.roleId === "canary-researcher" &&
      contract.runtime.referenceEligibilityContract.id ===
        "managed-context-reference-eligibility-v1" &&
      contract.runtime.referenceEligibilityContract.field === "referenceEligible" &&
      contract.runtime.referenceEligibilityContract.directTaskEvidence === true &&
      contract.runtime.referenceEligibilityContract.explicitLinkOnlyTaskEvidence === false &&
      contract.runtime.referenceEligibilityContract.directProvenanceWins === true &&
      contract.runtime.referenceEligibilityContract.governanceContext === false &&
      contract.runtime.referenceEligibilityContract.ineligibleEvidenceToken === null &&
      contract.runtime.referenceEligibilityContract.receiptEligibilityMatchRequired === true &&
      contract.runtime.referenceEligibilityContract.fabricatedIneligibleTokenProducesE4 === false &&
      contract.runtime.providerNeutralReferenceInstructionDigest ===
        "sha256:c5264794ff020589bae9035463fbb4ef64aba44307afe3f39e0d3819e7ac9b57" &&
      contract.runtime.referenceObservationPolicy ===
        "record_predeclared_eligible_e4_from_raw_provider_output_without_ground_truth_filtering" &&
      contract.runtime.executionContract.authorizationBinding ===
        "exact_prepared_manifest_digest" &&
      contract.runtime.executionContract.attemptPersistence === "before_provider_call" &&
      contract.runtime.executionContract.sourceBuildRevalidation === "before_every_task" &&
      contract.runtime.executionContract.maximumConcurrentCalls === 1 &&
      contract.measurementPredecessor.checkpointId ===
        "linked-evidence-managed-canary-v14-typed-execution-20260829" &&
      contract.measurementPredecessor.preparedManifestDigest ===
        "sha256:d743509f0645116cb04645b3548fa01c10884c0631e9955cb89c98423b501ebe" &&
      contract.measurementPredecessor.observationSetDigest ===
        "sha256:3352f205dcf8051791430e69a707e8e00c0b379fce05ca93eb306efe79fdacd7" &&
      contract.measurementPredecessor.completedRuns === 16 &&
      contract.measurementPredecessor.technicalFailures === 0 &&
      contract.measurementPredecessor.activationRejected === true &&
      contract.measurementPredecessor.immutable === true &&
      contract.measurementPredecessor.rescore === false &&
      contract.diagnostic.v14Rescored === false &&
      contract.diagnostic.linkedDocumentsRemainInjected === true &&
      contract.authorization.operatorAuthority ===
        "explicit_user_autonomous_completion_after_exact_v15_manifest_review",
    "The managed canary v15 checkpoint violates claim eligibility or the immutable v14 binding.",
  );
}

function validateV16(contract) {
  assert(
    contract.preparation.workstreamRevision === 247 &&
      contract.preparation.workstreamTitle ===
        "Complete successor claim-eligibility canary and activate" &&
      hasDeterministicSelection(contract) &&
      hasNativeSessionArms(contract) &&
      contract.task.roleId === "canary-researcher" &&
      contract.runtime.referenceEligibilityContract.id ===
        "managed-context-reference-eligibility-v1" &&
      contract.runtime.measurementProjection.source === "canonical_e4_context_evidence" &&
      contract.runtime.measurementProjection.documentIdsSorted === true &&
      contract.runtime.measurementProjection.documentIdsDeduplicated === true &&
      contract.runtime.measurementProjection.providerOutputParsing === false &&
      contract.runtime.measurementProjection.groundTruthFiltering === false &&
      contract.runtime.executionContract.authorizationBinding ===
        "exact_prepared_manifest_digest" &&
      contract.runtime.executionContract.attemptPersistence === "before_provider_call" &&
      contract.runtime.executionContract.sourceBuildRevalidation === "before_every_task" &&
      contract.runtime.executionContract.maximumConcurrentCalls === 1 &&
      contract.technicalPredecessor.checkpointId ===
        "linked-evidence-managed-canary-v15-claim-eligibility-20260830" &&
      contract.technicalPredecessor.preparedManifestDigest ===
        "sha256:4b51c58f6a6c3443e1abe2a90d989ceab77314af575126effd95e9652872fccd" &&
      contract.technicalPredecessor.observationSetDigest ===
        "sha256:f4353b25add8b47f4d309642b7c50832cdbf64e540ebc2be7e23d87c67dcf237" &&
      contract.technicalPredecessor.completedRuns === 0 &&
      contract.technicalPredecessor.failedRuns === 1 &&
      contract.technicalPredecessor.providerCalls === 1 &&
      contract.technicalPredecessor.selectionCalls === 0 &&
      contract.technicalPredecessor.acceptedAccuracySamples === 0 &&
      contract.technicalPredecessor.immutable === true &&
      contract.technicalPredecessor.resume === false &&
      contract.technicalPredecessor.retry === false &&
      contract.accuracyPredecessor.preparedManifestDigest ===
        "sha256:d743509f0645116cb04645b3548fa01c10884c0631e9955cb89c98423b501ebe" &&
      contract.accuracyPredecessor.observationSetDigest ===
        "sha256:3352f205dcf8051791430e69a707e8e00c0b379fce05ca93eb306efe79fdacd7" &&
      contract.accuracyPredecessor.activationRejected === true &&
      contract.authorization.operatorAuthority ===
        "explicit_user_autonomous_completion_after_exact_v16_manifest_review",
    "The managed canary v16 checkpoint violates the E4 projection or immutable predecessor binding.",
  );
}

function validateV17(contract) {
  assert(
    contract.preparation.workstreamRevision === 248 &&
      contract.preparation.workstreamTitle ===
        "Complete capacity-safe claim-eligibility canary and activate" &&
      hasDeterministicSelection(contract) &&
      hasNativeSessionArms(contract) &&
      contract.task.roleId === "canary-researcher" &&
      contract.runtime.referenceEligibilityContract.id ===
        "managed-context-reference-eligibility-v1" &&
      contract.runtime.measurementProjection.source === "canonical_e4_context_evidence" &&
      contract.runtime.measurementProjection.providerOutputParsing === false &&
      contract.runtime.measurementProjection.groundTruthFiltering === false &&
      contract.runtime.observationCapacity.sourceRecordBaseline === 64 &&
      contract.runtime.observationCapacity.maximumRecords === 128 &&
      contract.runtime.observationCapacity.historicalRecordsDeleted === false &&
      contract.runtime.observationCapacity.overflowFailureCode === "observation_limit_exceeded" &&
      contract.runtime.executionContract.authorizationBinding ===
        "exact_prepared_manifest_digest" &&
      contract.runtime.executionContract.attemptPersistence === "before_provider_call" &&
      contract.runtime.executionContract.sourceBuildRevalidation === "before_every_task" &&
      contract.runtime.executionContract.maximumConcurrentCalls === 1 &&
      contract.technicalPredecessor.checkpointId ===
        "linked-evidence-managed-canary-v16-claim-eligibility-20260830" &&
      contract.technicalPredecessor.preparedManifestDigest ===
        "sha256:c36e9650eb2adf3d00715090643866977b6274a28a34890498c36d1766fa9b84" &&
      contract.technicalPredecessor.observationSetDigest ===
        "sha256:d79d2b2f4aee533c05a190b45035a65376671f277b09b17c71073a5edd57dc49" &&
      contract.technicalPredecessor.completedRuns === 11 &&
      contract.technicalPredecessor.failedRuns === 1 &&
      contract.technicalPredecessor.providerCalls === 12 &&
      contract.technicalPredecessor.selectionCalls === 0 &&
      contract.technicalPredecessor.acceptedAccuracySamples === 11 &&
      contract.technicalPredecessor.sourceRecordBaseline === 64 &&
      contract.technicalPredecessor.sourceRecordLimit === 64 &&
      contract.technicalPredecessor.immutable === true &&
      contract.technicalPredecessor.resume === false &&
      contract.technicalPredecessor.retry === false &&
      contract.accuracyPredecessor.preparedManifestDigest ===
        "sha256:d743509f0645116cb04645b3548fa01c10884c0631e9955cb89c98423b501ebe" &&
      contract.accuracyPredecessor.observationSetDigest ===
        "sha256:3352f205dcf8051791430e69a707e8e00c0b379fce05ca93eb306efe79fdacd7" &&
      contract.accuracyPredecessor.activationRejected === true &&
      contract.authorization.operatorAuthority ===
        "explicit_user_autonomous_completion_after_exact_v17_manifest_review",
    "The managed canary v17 checkpoint violates the capacity or immutable predecessor binding.",
  );
}

function validateV18(contract) {
  assert(
    contract.preparation.workstreamRevision === 249 &&
      contract.preparation.workstreamTitle ===
        "Complete capacity-safe evidence canary and activate" &&
      hasDeterministicSelection(contract) &&
      hasNativeSessionArms(contract) &&
      contract.task.roleId === "canary-researcher" &&
      contract.runtime.referenceEligibilityContract.id ===
        "managed-context-reference-eligibility-v1" &&
      contract.runtime.measurementProjection.source === "canonical_e4_context_evidence" &&
      contract.runtime.measurementProjection.providerOutputParsing === false &&
      contract.runtime.measurementProjection.groundTruthFiltering === false &&
      contract.runtime.observationCapacity.sourceRecordBaseline === 74 &&
      contract.runtime.observationCapacity.maximumRecords === 128 &&
      contract.runtime.observationCapacity.historicalRecordsDeleted === false &&
      contract.runtime.observationCapacity.sourceRelevantEventBaseline === 4105 &&
      contract.runtime.observationCapacity.maximumRelevantEvents === 8192 &&
      contract.runtime.observationCapacity.maximumTotalEventBytes === 16 * 1024 * 1024 &&
      contract.runtime.observationCapacity.historicalEventsDeleted === false &&
      contract.runtime.observationCapacity.eventProjectionTruncated === false &&
      contract.runtime.observationCapacity.overflowFailureCode ===
        "knowledge_evidence_source_invalid" &&
      contract.runtime.executionContract.authorizationBinding ===
        "exact_prepared_manifest_digest" &&
      contract.runtime.executionContract.attemptPersistence === "before_provider_call" &&
      contract.runtime.executionContract.sourceBuildRevalidation === "before_every_task" &&
      contract.runtime.executionContract.maximumConcurrentCalls === 1 &&
      contract.technicalPredecessor.checkpointId ===
        "linked-evidence-managed-canary-v17-capacity-safe-20260830" &&
      contract.technicalPredecessor.preparedManifestDigest ===
        "sha256:70f21a85823e0fc5a7b078860155859f5c1ce25e9d2fb2f9c0c0387dd0a50074" &&
      contract.technicalPredecessor.observationSetDigest ===
        "sha256:0a7d03e5b8064057ce9a293b04ce03a297ac53a3efc4e9c09edc74b75d5a626e" &&
      contract.technicalPredecessor.completedRuns === 10 &&
      contract.technicalPredecessor.failedRuns === 1 &&
      contract.technicalPredecessor.providerCalls === 10 &&
      contract.technicalPredecessor.selectionCalls === 0 &&
      contract.technicalPredecessor.acceptedAccuracySamples === 10 &&
      contract.technicalPredecessor.failedRunTaskProviderCalls === 0 &&
      contract.technicalPredecessor.failedRunAdapterCreations === 0 &&
      contract.technicalPredecessor.immutable === true &&
      contract.technicalPredecessor.resume === false &&
      contract.technicalPredecessor.retry === false &&
      contract.accuracyPredecessor.activationRejected === true &&
      contract.authorization.operatorAuthority ===
        "explicit_user_autonomous_completion_after_exact_v18_manifest_review",
    "The managed canary v18 checkpoint violates complete-event capacity or predecessor binding.",
  );
}

export function validateRecentManagedCanaryCheckpoint(contract, version) {
  if (version === 6) validateV6(contract);
  if (version === 7) validateV7(contract);
  if (version === 8) validateV8(contract);
  if (version === 9) validateV9(contract);
  if (version === 10) validateV10(contract);
  if (version === 11) validateV11(contract);
  if (version === 12) validateV12(contract);
  if (version === 13) validateV13(contract);
  if (version === 14) validateV14(contract);
  if (version === 15) validateV15(contract);
  if (version === 16) validateV16(contract);
  if (version === 17) validateV17(contract);
  if (version === 18) validateV18(contract);
}
