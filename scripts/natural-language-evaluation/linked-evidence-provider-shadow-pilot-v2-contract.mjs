import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { linkedEvidenceReconciliationV8SelectionProtocolDigest } from "./linked-evidence-reconciliation-v8-contract.mjs";
import {
  providerShadowV2CanonicalCandidateFields,
  providerShadowV2TerminalStateKinds,
} from "./linked-evidence-provider-shadow-pilot-v2-policy.mjs";
import {
  providerShadowClaimCoverageSelectionProtocolDigest,
  providerShadowMinimalSelectionProtocolDigest,
  providerShadowRelationalCoverageSelectionProtocolDigest,
  providerShadowRequestScopedClaimCoverageSelectionProtocolDigest,
} from "./linked-evidence-provider-shadow-selection-protocol.mjs";

export * from "./linked-evidence-provider-shadow-pilot-v2-policy.mjs";

export const authorizedProviderShadowV2ContractDigest =
  "sha256:2e672fd36dbd9d3521a95394f29f78782fbb66e5bd52ca7459a25d2a883342f4";
export const authorizedProviderShadowV3ContractDigest =
  "sha256:e877622dcb06c4b5963e0fd9ebb2e1e7b23067bf6353672bbfeea20b048556fc";
export const authorizedProviderShadowV4ContractDigest =
  "sha256:08ab9c78a785d6967f0ce10c590390c05b38f99cbb807f835648571808e4f9d3";
export const authorizedProviderShadowV5ContractDigest =
  "sha256:34f0211e514edd367ed7a310c123de02f9f5e05354a814ac9ebcbae59758f77c";
export const authorizedProviderShadowV6ContractDigest =
  "sha256:05f0747db9e888f3fc5500c873a9d56cce4e13545d470570eac63e7e74d46947";
export const authorizedProviderShadowV7ContractDigest =
  "sha256:0a7d6f913bcc9b09a20ff2ad62e6b895a6eda16ea9d0b540985886fc45d6614f";
export const authorizedProviderShadowV8ContractDigest =
  "sha256:765cba530a02fdf1beaab5a27333bf6684922b768eeb27bf885542beb1a67eac";
export const authorizedProviderShadowV9ContractDigest =
  "sha256:14d72e8dab12ba6124df7880448748b507d2fb9d468d988e68999e5a2a36bf9b";
export const authorizedProviderShadowV10ContractDigest =
  "sha256:827d7f67528d6bdc10215f48a6114ffb720d4f563a62e4dce14f5c62698c4ffc";
export const authorizedProviderShadowV11ContractDigest =
  "sha256:4d4c5a762e04c2379fe206aeb410b1a4e83fffde631af88333c5a9523a6b0bd1";
export const authorizedProviderShadowV12ContractDigest =
  "sha256:bafc9b982445d32f6d09ea4601b489a9ea0b968e474f5df269192f513e03cd74";
export const authorizedProviderShadowV13ContractDigest =
  "sha256:e6db21bed98165d53acd916504a0b5acd61a8c8fae88f90571aecefea370d944";
export const authorizedProviderShadowV14ContractDigest =
  "sha256:037e952ea95358d851786b06528e9aa2a2a1acaeba3d3d7c7ed4a66cab40eed6";
export const authorizedProviderShadowV15ContractDigest =
  "sha256:fe1b4852fd4c532bee816defe020081bd1db6078e8524996af95cde8cadb2202";
export const authorizedProviderShadowV16ContractDigest =
  "sha256:7520a5ed8a3801c288250269468a6e6be333bc2c37a2712de5a9771ff62c9efe";
export const authorizedProviderShadowV17ContractDigest =
  "sha256:12287835555004972086111f9b0f013cc848de387d75b457fe385cfc7537d746";
export const authorizedProviderShadowV18ContractDigest =
  "sha256:b6e8a1f1898c13d815c63d0b4446e6c170c9e595f18dee171e49a4fb638ae4af";

function composeContract(base, overlay) {
  const nested = [
    "authorization",
    "predecessor",
    "sourcePopulation",
    "groundTruth",
    "selectionProtocol",
    "candidateIdentity",
    "candidateEnvelope",
    "provider",
    "failureDiagnostics",
    "attemptJournal",
    "observation",
    "recovery",
    "nonResumability",
    "noEffect",
    "acceptance",
  ];
  const composed = { ...base, ...overlay };
  for (const field of nested) composed[field] = { ...base[field], ...overlay[field] };
  return composed;
}

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export async function loadProviderShadowV2Contract(
  repositoryRoot,
  contractPath = "benchmarks/search/linked-evidence-provider-shadow-pilot-v2.json",
) {
  const contractBytes = await readFile(resolve(repositoryRoot, contractPath));
  const contractDigest = sha256(contractBytes);
  const rawContract = JSON.parse(contractBytes.toString("utf8"));
  let contract = rawContract;
  if (rawContract.baseContractPath !== undefined) {
    const baseBytes = await readFile(resolve(repositoryRoot, rawContract.baseContractPath));
    assert(
      sha256(baseBytes) === authorizedProviderShadowV7ContractDigest,
      "The provider-shadow base contract differs from the exact reviewed bytes.",
    );
    contract = composeContract(JSON.parse(baseBytes.toString("utf8")), rawContract);
  }
  const expectedContractDigest =
    contract.decisionId === "ADR-0255"
      ? authorizedProviderShadowV2ContractDigest
      : contract.decisionId === "ADR-0256"
        ? authorizedProviderShadowV3ContractDigest
        : contract.decisionId === "ADR-0257"
          ? authorizedProviderShadowV4ContractDigest
          : contract.decisionId === "ADR-0258"
            ? authorizedProviderShadowV5ContractDigest
            : contract.decisionId === "ADR-0259"
              ? authorizedProviderShadowV6ContractDigest
              : contract.decisionId === "ADR-0260"
                ? authorizedProviderShadowV7ContractDigest
                : contract.decisionId === "ADR-0261"
                  ? authorizedProviderShadowV8ContractDigest
                  : contract.decisionId === "ADR-0262"
                    ? authorizedProviderShadowV9ContractDigest
                    : contract.decisionId === "ADR-0264"
                      ? authorizedProviderShadowV10ContractDigest
                      : contract.decisionId === "ADR-0265"
                        ? authorizedProviderShadowV11ContractDigest
                        : contract.decisionId === "ADR-0266"
                          ? authorizedProviderShadowV12ContractDigest
                          : contract.decisionId === "ADR-0268"
                            ? authorizedProviderShadowV13ContractDigest
                            : contract.decisionId === "ADR-0269"
                              ? authorizedProviderShadowV14ContractDigest
                              : contract.decisionId === "ADR-0271"
                                ? authorizedProviderShadowV15ContractDigest
                                : contract.decisionId === "ADR-0273"
                                  ? authorizedProviderShadowV16ContractDigest
                                  : contract.decisionId === "ADR-0274"
                                    ? authorizedProviderShadowV17ContractDigest
                                    : authorizedProviderShadowV18ContractDigest;
  assert(
    contractDigest === expectedContractDigest,
    "The provider-shadow contract differs from the exact reviewed bytes.",
  );
  const suiteBytes = await readFile(resolve(repositoryRoot, contract.groundTruth.sourceSuitePath));
  const suite = JSON.parse(suiteBytes.toString("utf8"));
  const eligibleCases = suite.cases.filter(
    (item) => item.lexicalExpectation === contract.groundTruth.eligibleLexicalExpectation,
  );
  const claudeMicroPilot = ["ADR-0258", "ADR-0259", "ADR-0260", "ADR-0261"].includes(
    contract.decisionId,
  );
  const pairedMicroPilot = contract.decisionId === "ADR-0262";
  const unambiguousExpansion = contract.decisionId === "ADR-0264";
  const claimCoverageMicroPilot = contract.decisionId === "ADR-0265";
  const claimCoverageConfirmation = contract.decisionId === "ADR-0266";
  const diagnosticClaimCoverageConfirmation = contract.decisionId === "ADR-0268";
  const structuredCarrierRequestScopedMicroPilot = ["ADR-0271", "ADR-0273"].includes(
    contract.decisionId,
  );
  const relationalCoverageMicroPilot = contract.decisionId === "ADR-0274";
  const relationalCoverageConfirmation = contract.decisionId === "ADR-0276";
  const requestScopedClaimCoverageMicroPilot =
    contract.decisionId === "ADR-0269" ||
    structuredCarrierRequestScopedMicroPilot ||
    relationalCoverageMicroPilot;
  const fullClaimCoverageConfirmation =
    claimCoverageConfirmation ||
    diagnosticClaimCoverageConfirmation ||
    relationalCoverageConfirmation;
  const microPilot =
    claudeMicroPilot ||
    pairedMicroPilot ||
    unambiguousExpansion ||
    claimCoverageMicroPilot ||
    requestScopedClaimCoverageMicroPilot ||
    fullClaimCoverageConfirmation;
  const expectedSourceSampleCount =
    claimCoverageMicroPilot || requestScopedClaimCoverageMicroPilot
      ? 8
      : unambiguousExpansion || fullClaimCoverageConfirmation
        ? 16
        : pairedMicroPilot
          ? 6
          : claudeMicroPilot
            ? 3
            : 24;
  const expectedProviderObservationCount =
    claimCoverageMicroPilot || requestScopedClaimCoverageMicroPilot
      ? 16
      : unambiguousExpansion || fullClaimCoverageConfirmation
        ? 32
        : pairedMicroPilot
          ? 12
          : claudeMicroPilot
            ? 3
            : 48;
  const expectedProviderArmCount = claudeMicroPilot ? 1 : 2;
  const expectedProviderCallsPerArm =
    claimCoverageMicroPilot || requestScopedClaimCoverageMicroPilot
      ? 8
      : unambiguousExpansion || fullClaimCoverageConfirmation
        ? 16
        : pairedMicroPilot
          ? 6
          : claudeMicroPilot
            ? 3
            : 24;
  const selectedCaseIds = microPilot ? contract.sourcePopulation.selectedCaseIds : null;
  const executionCases = microPilot
    ? selectedCaseIds.map((caseId) => eligibleCases.find((item) => item.caseId === caseId))
    : eligibleCases;

  assert(
    contract.schemaVersion === (microPilot ? 4 : 3),
    "The provider-shadow schema version is invalid.",
  );
  assert(
    [
      "ADR-0255",
      "ADR-0256",
      "ADR-0257",
      "ADR-0258",
      "ADR-0259",
      "ADR-0260",
      "ADR-0261",
      "ADR-0262",
      "ADR-0264",
      "ADR-0265",
      "ADR-0266",
      "ADR-0268",
      "ADR-0269",
      "ADR-0271",
      "ADR-0273",
      "ADR-0274",
      "ADR-0276",
    ].includes(contract.decisionId),
    "The provider-shadow decision is invalid.",
  );
  assert(
    contract.authorization.status ===
      (relationalCoverageConfirmation
        ? "authorized_exact_relational_coverage_full_confirmation"
        : relationalCoverageMicroPilot
          ? "authorized_exact_relational_coverage_structured_paired_micro_pilot"
          : structuredCarrierRequestScopedMicroPilot
            ? "authorized_exact_structured_carrier_request_scoped_paired_micro_pilot"
            : requestScopedClaimCoverageMicroPilot
              ? "authorized_exact_request_scoped_claim_coverage_paired_micro_pilot"
              : claimCoverageMicroPilot
                ? "authorized_exact_claim_coverage_paired_micro_pilot"
                : fullClaimCoverageConfirmation
                  ? diagnosticClaimCoverageConfirmation
                    ? "authorized_exact_diagnostic_claim_coverage_full_confirmation"
                    : "authorized_exact_claim_coverage_full_confirmation"
                  : unambiguousExpansion
                    ? "authorized_exact_unambiguous_paired_measurement"
                    : pairedMicroPilot
                      ? "authorized_exact_paired_selection_quality_micro_pilot"
                      : claudeMicroPilot
                        ? "authorized_exact_claude_structured_selection_micro_pilot"
                        : "authorized_exact_paired_execution") &&
      contract.authorization.providerCallsAuthorized === true &&
      contract.authorization.maximumProviderInvocationsAuthorized ===
        expectedProviderObservationCount &&
      contract.authorization.managedContextEffectsAuthorized === false &&
      contract.authorization.canaryAuthorized === false &&
      contract.authorization.productionActivationAuthorized === false,
    "The provider-shadow contract has an invalid authority boundary.",
  );
  assert(
    contract.predecessor.disposition ===
      (relationalCoverageConfirmation
        ? "preserve_completed_passed"
        : requestScopedClaimCoverageMicroPilot
          ? "preserve_completed_rejected"
          : "preserve_stopped_rejected") &&
      contract.predecessor.resume === false &&
      contract.predecessor.retry === false &&
      contract.predecessor.reuseProviderResults === false &&
      contract.predecessor.borrowCoordinates === false,
    "The stopped predecessor pilot must remain immutable and excluded from successor evidence.",
  );
  assert(
    sha256(suiteBytes) === contract.groundTruth.sourceSuiteDigest,
    "The source suite changed.",
  );
  assert(
    contract.selectionProtocol.protocolDigest ===
      (relationalCoverageMicroPilot || relationalCoverageConfirmation
        ? providerShadowRelationalCoverageSelectionProtocolDigest
        : requestScopedClaimCoverageMicroPilot
          ? providerShadowRequestScopedClaimCoverageSelectionProtocolDigest
          : claimCoverageMicroPilot
            ? providerShadowClaimCoverageSelectionProtocolDigest
            : fullClaimCoverageConfirmation
              ? providerShadowClaimCoverageSelectionProtocolDigest
              : pairedMicroPilot || unambiguousExpansion
                ? providerShadowMinimalSelectionProtocolDigest
                : linkedEvidenceReconciliationV8SelectionProtocolDigest),
    "The selection protocol changed.",
  );
  assert(
    JSON.stringify(contract.candidateIdentity.canonicalFields) ===
      JSON.stringify(providerShadowV2CanonicalCandidateFields) &&
      contract.candidateIdentity.translationBoundary === "provider_free_preparation" &&
      contract.candidateIdentity.sourceIdAllowedAfterPreparation === false,
    "The canonical candidate identity boundary is invalid.",
  );
  assert(eligibleCases.length === 6, "The provider-shadow case population is invalid.");
  if (unambiguousExpansion || fullClaimCoverageConfirmation) {
    const included = new Set(contract.sourcePopulation.selectedCaseIds);
    const excluded = new Set(contract.sourcePopulation.excludedCaseIds);
    assert(
      included.size === 4 &&
        excluded.size === 2 &&
        [...included].every((caseId) => !excluded.has(caseId)) &&
        [...included, ...excluded].every((caseId) =>
          eligibleCases.some((item) => item.caseId === caseId),
        ) &&
        contract.sourcePopulation.exclusionDisposition ===
          "excluded_from_numerator_and_denominator_without_reclassification" &&
        contract.groundTruth.ambiguityExclusionPolicy === "exclude_without_reclassification" &&
        contract.groundTruth.excludedCasesAreSuccesses === false &&
        (!fullClaimCoverageConfirmation ||
          (contract.groundTruth.preserveV10ExpectedDocumentIds === true &&
            contract.groundTruth.providerOutputMayChangeGroundTruth === false &&
            contract.selectionProtocol.claimCoverageBeforeMinimizationRequired === true &&
            (!relationalCoverageConfirmation ||
              (contract.selectionProtocol.requestScopeBeforeClaimCoverageRequired === true &&
                contract.selectionProtocol.relationSidePreservationRequired === true)))),
      "The provider-shadow ambiguity exclusion boundary is invalid.",
    );
  }
  if (claimCoverageMicroPilot) {
    const selected = new Set(contract.sourcePopulation.selectedCaseIds);
    const nonTargets = new Set(contract.sourcePopulation.nonTargetCaseIds);
    assert(
      selected.size === 2 &&
        nonTargets.size === 4 &&
        [...selected].every((caseId) => !nonTargets.has(caseId)) &&
        [...selected, ...nonTargets].every((caseId) =>
          eligibleCases.some((item) => item.caseId === caseId),
        ) &&
        contract.sourcePopulation.nonTargetDisposition ===
          "not_evaluated_without_reclassification" &&
        contract.groundTruth.preserveV10ExpectedDocumentIds === true &&
        contract.groundTruth.providerOutputMayChangeGroundTruth === false &&
        contract.selectionProtocol.claimCoverageBeforeMinimizationRequired === true,
      "The provider-shadow claim-coverage diagnostic boundary is invalid.",
    );
  }
  if (requestScopedClaimCoverageMicroPilot) {
    const selected = new Set(contract.sourcePopulation.selectedCaseIds);
    const nonTargets = new Set(contract.sourcePopulation.nonTargetCaseIds);
    assert(
      selected.size === 2 &&
        nonTargets.size === 4 &&
        [...selected].every((caseId) => !nonTargets.has(caseId)) &&
        [...selected, ...nonTargets].every((caseId) =>
          eligibleCases.some((item) => item.caseId === caseId),
        ) &&
        contract.sourcePopulation.nonTargetDisposition ===
          "not_evaluated_without_reclassification" &&
        contract.groundTruth.preserveV10ExpectedDocumentIds === true &&
        contract.groundTruth.providerOutputMayChangeGroundTruth === false &&
        contract.selectionProtocol.requestScopeBeforeClaimCoverageRequired === true &&
        contract.selectionProtocol.claimCoverageBeforeMinimizationRequired === true &&
        (!relationalCoverageMicroPilot ||
          contract.selectionProtocol.relationSidePreservationRequired === true),
      "The provider-shadow request-scoped diagnostic boundary is invalid.",
    );
  }
  assert(
    executionCases.every((item) => item !== undefined) &&
      new Set(executionCases.map((item) => item.caseId)).size === executionCases.length &&
      executionCases.length * contract.sourcePopulation.expectedRepetitionsPerCase ===
        contract.sourcePopulation.expectedShadowSampleCount &&
      contract.sourcePopulation.expectedShadowSampleCount === expectedSourceSampleCount,
    "The provider-shadow sample population is invalid.",
  );
  assert(
    contract.provider.comparisonKind ===
      (relationalCoverageConfirmation
        ? "paired_same_sample_cross_provider_relational_coverage_confirmation"
        : relationalCoverageMicroPilot
          ? "paired_same_sample_cross_provider_relational_coverage_structured_micro"
          : structuredCarrierRequestScopedMicroPilot
            ? "paired_same_sample_cross_provider_structured_carrier_request_scoped_claim_coverage_micro"
            : requestScopedClaimCoverageMicroPilot
              ? "paired_same_sample_cross_provider_request_scoped_claim_coverage_micro"
              : claimCoverageMicroPilot
                ? "paired_same_sample_cross_provider_claim_coverage_micro"
                : fullClaimCoverageConfirmation
                  ? diagnosticClaimCoverageConfirmation
                    ? "paired_same_sample_cross_provider_diagnostic_claim_coverage_confirmation"
                    : "paired_same_sample_cross_provider_claim_coverage_confirmation"
                  : unambiguousExpansion
                    ? "paired_same_sample_cross_provider_unambiguous_expansion"
                    : pairedMicroPilot
                      ? "paired_same_sample_cross_provider_micro"
                      : claudeMicroPilot
                        ? "claude_structured_selection_compatibility"
                        : "paired_same_sample_cross_provider") &&
      contract.provider.arms.length === expectedProviderArmCount &&
      (claudeMicroPilot ||
        (contract.provider.arms[0].provider === "codex" &&
          contract.provider.arms[0].model === "gpt-5.6-sol")) &&
      contract.provider.arms.at(-1).provider === "claude" &&
      contract.provider.arms.at(-1).model === "opus" &&
      contract.provider.arms.every(
        (arm) => arm.maximumProviderInvocations === expectedProviderCallsPerArm,
      ) &&
      contract.provider.maximumProviderInvocations === expectedProviderObservationCount &&
      contract.provider.maximumProviderInvocationsPerArm === expectedProviderCallsPerArm &&
      contract.provider.maximumAttemptsPerSample === 1 &&
      contract.provider.maximumRetries === 0 &&
      contract.provider.maximumReplacementSamples === 0 &&
      contract.provider.maximumRepairTurns === 0 &&
      contract.provider.maximumAnswerTurns === 0,
    "The provider-shadow budget is invalid.",
  );
  assert(
    contract.decisionId === "ADR-0255" ||
      (contract.sourcePopulation.coordinatePrefix === "psv3" &&
        Array.isArray(contract.provider.claudeTools) &&
        contract.provider.claudeTools.length === 0 &&
        contract.provider.cumulativeMaximumProviderInvocationsIncludingV2 === 50) ||
      (contract.sourcePopulation.coordinatePrefix === "psv4" &&
        Array.isArray(contract.provider.claudeTools) &&
        contract.provider.claudeTools.length === 0 &&
        contract.provider.claudeUsageCapability === "supported" &&
        contract.provider.cumulativeMaximumProviderInvocationsIncludingPredecessors === 51) ||
      (contract.sourcePopulation.coordinatePrefix === "psv5" &&
        Array.isArray(contract.provider.claudeTools) &&
        contract.provider.claudeTools.length === 0 &&
        contract.provider.claudeUsageCapability === "supported" &&
        contract.provider.claudeStructuredOutput === "json_schema" &&
        contract.provider.cumulativeMaximumProviderInvocationsIncludingPredecessors === 54 &&
        contract.selectionProtocol.output === "structured_exact_e4_token_array") ||
      (contract.sourcePopulation.coordinatePrefix === "psv6" &&
        Array.isArray(contract.provider.claudeTools) &&
        contract.provider.claudeTools.length === 0 &&
        contract.provider.claudeUsageCapability === "supported" &&
        contract.provider.claudeStructuredOutput === "json_schema" &&
        contract.provider.durableFailureCodeRequired === true &&
        contract.provider.cumulativeMaximumProviderInvocationsIncludingPredecessors === 57 &&
        contract.selectionProtocol.output === "structured_exact_e4_token_array") ||
      (contract.sourcePopulation.coordinatePrefix === "psv7" &&
        contract.sourcePopulation.repetitionStart === 2 &&
        Array.isArray(contract.provider.claudeTools) &&
        contract.provider.claudeTools.length === 0 &&
        contract.provider.claudeUsageCapability === "supported" &&
        contract.provider.claudeStructuredOutput === "json_schema" &&
        contract.provider.durableFailureCodeRequired === true &&
        contract.provider.maximumStructuredOutputFramingToolsPerInvocation === 1 &&
        contract.provider.cumulativeMaximumProviderInvocationsIncludingPredecessors === 60 &&
        contract.selectionProtocol.output === "structured_exact_e4_token_array") ||
      (contract.sourcePopulation.coordinatePrefix === "psv8" &&
        contract.sourcePopulation.repetitionStart === 3 &&
        contract.selectionProtocol.maximumSelectedSources === 2 &&
        contract.provider.maximumStructuredOutputFramingToolsPerInvocation === 1 &&
        contract.provider.cumulativeMaximumProviderInvocationsIncludingPredecessors === 63 &&
        contract.selectionProtocol.output === "structured_exact_e4_token_array") ||
      (contract.sourcePopulation.coordinatePrefix === "psv9" &&
        contract.sourcePopulation.repetitionStart === 4 &&
        contract.selectionProtocol.maximumSelectedSources === 8 &&
        contract.selectionProtocol.minimalSufficientSelectionRequired === true &&
        contract.provider.maximumStructuredOutputFramingToolsPerInvocation === 1 &&
        contract.provider.cumulativeMaximumProviderInvocationsIncludingPredecessors === 75 &&
        contract.selectionProtocol.output === "provider_native_exact_e4_token_set") ||
      (contract.sourcePopulation.coordinatePrefix === "psv10" &&
        contract.sourcePopulation.repetitionStart === 1 &&
        contract.sourcePopulation.expectedRepetitionsPerCase === 4 &&
        contract.selectionProtocol.maximumSelectedSources === 8 &&
        contract.selectionProtocol.minimalSufficientSelectionRequired === true &&
        contract.provider.maximumStructuredOutputFramingToolsPerInvocation === 1 &&
        contract.provider.cumulativeMaximumProviderInvocationsIncludingPredecessors === 107 &&
        contract.selectionProtocol.output === "provider_native_exact_e4_token_set") ||
      (contract.sourcePopulation.coordinatePrefix === "psv11" &&
        contract.sourcePopulation.repetitionStart === 1 &&
        contract.sourcePopulation.expectedRepetitionsPerCase === 4 &&
        contract.selectionProtocol.maximumSelectedSources === 8 &&
        contract.selectionProtocol.claimCoverageBeforeMinimizationRequired === true &&
        contract.provider.maximumStructuredOutputFramingToolsPerInvocation === 1 &&
        contract.provider.cumulativeMaximumProviderInvocationsIncludingPredecessors === 123 &&
        contract.selectionProtocol.output === "provider_native_exact_e4_token_set") ||
      (contract.sourcePopulation.coordinatePrefix === "psv12" &&
        contract.sourcePopulation.repetitionStart === 1 &&
        contract.sourcePopulation.expectedRepetitionsPerCase === 4 &&
        contract.selectionProtocol.maximumSelectedSources === 8 &&
        contract.selectionProtocol.claimCoverageBeforeMinimizationRequired === true &&
        contract.provider.maximumStructuredOutputFramingToolsPerInvocation === 1 &&
        contract.provider.cumulativeMaximumProviderInvocationsIncludingPredecessors === 155 &&
        contract.selectionProtocol.output === "provider_native_exact_e4_token_set") ||
      (contract.sourcePopulation.coordinatePrefix === "psv13" &&
        contract.sourcePopulation.repetitionStart === 1 &&
        contract.sourcePopulation.expectedRepetitionsPerCase === 4 &&
        contract.selectionProtocol.maximumSelectedSources === 8 &&
        contract.selectionProtocol.claimCoverageBeforeMinimizationRequired === true &&
        contract.provider.maximumStructuredOutputFramingToolsPerInvocation === 1 &&
        contract.provider.cumulativeMaximumProviderInvocationsIncludingPredecessors === 187 &&
        contract.failureDiagnostics.selectionViolationCodesRequired === true &&
        contract.failureDiagnostics.selectionViolationCodeSource === "provider_neutral_parser" &&
        contract.failureDiagnostics.rawProviderOutputRetained === false &&
        contract.failureDiagnostics.priorFailureReclassificationAuthorized === false &&
        contract.selectionProtocol.output === "provider_native_exact_e4_token_set") ||
      (contract.sourcePopulation.coordinatePrefix === "psv14" &&
        contract.sourcePopulation.repetitionStart === 1 &&
        contract.sourcePopulation.expectedRepetitionsPerCase === 4 &&
        contract.selectionProtocol.maximumSelectedSources === 8 &&
        contract.selectionProtocol.requestScopeBeforeClaimCoverageRequired === true &&
        contract.selectionProtocol.claimCoverageBeforeMinimizationRequired === true &&
        contract.provider.maximumStructuredOutputFramingToolsPerInvocation === 1 &&
        contract.provider.cumulativeMaximumProviderInvocationsIncludingPredecessors === 203 &&
        contract.failureDiagnostics.selectionViolationCodesRequired === true &&
        contract.failureDiagnostics.selectionViolationCodeSource === "provider_neutral_parser" &&
        contract.failureDiagnostics.rawProviderOutputRetained === false &&
        contract.failureDiagnostics.priorFailureReclassificationAuthorized === false &&
        contract.selectionProtocol.output === "provider_native_exact_e4_token_set") ||
      (contract.sourcePopulation.coordinatePrefix === "psv15" &&
        contract.sourcePopulation.repetitionStart === 1 &&
        contract.sourcePopulation.expectedRepetitionsPerCase === 4 &&
        contract.selectionProtocol.maximumSelectedSources === 8 &&
        contract.selectionProtocol.requestScopeBeforeClaimCoverageRequired === true &&
        contract.selectionProtocol.claimCoverageBeforeMinimizationRequired === true &&
        contract.provider.maximumStructuredOutputFramingToolsPerInvocation === 1 &&
        contract.provider.cumulativeMaximumProviderInvocationsIncludingPredecessors === 219 &&
        contract.failureDiagnostics.selectionViolationCodesRequired === true &&
        contract.failureDiagnostics.selectionViolationCodeSource === "provider_neutral_parser" &&
        contract.failureDiagnostics.rawProviderOutputRetained === false &&
        contract.failureDiagnostics.priorFailureReclassificationAuthorized === false &&
        contract.selectionProtocol.output === "structured_exact_e4_token_array") ||
      (contract.sourcePopulation.coordinatePrefix === "psv16" &&
        contract.sourcePopulation.repetitionStart === 1 &&
        contract.sourcePopulation.expectedRepetitionsPerCase === 4 &&
        contract.selectionProtocol.maximumSelectedSources === 8 &&
        contract.selectionProtocol.requestScopeBeforeClaimCoverageRequired === true &&
        contract.selectionProtocol.claimCoverageBeforeMinimizationRequired === true &&
        contract.provider.maximumStructuredOutputFramingToolsPerInvocation === 1 &&
        contract.provider.cumulativeMaximumProviderInvocationsIncludingPredecessors === 235 &&
        contract.failureDiagnostics.selectionViolationCodesRequired === true &&
        contract.failureDiagnostics.selectionViolationCodeSource === "provider_neutral_parser" &&
        contract.failureDiagnostics.rawProviderOutputRetained === false &&
        contract.failureDiagnostics.priorFailureReclassificationAuthorized === false &&
        contract.selectionProtocol.output === "structured_exact_e4_token_array") ||
      (contract.sourcePopulation.coordinatePrefix === "psv17" &&
        contract.sourcePopulation.repetitionStart === 1 &&
        contract.sourcePopulation.expectedRepetitionsPerCase === 4 &&
        contract.selectionProtocol.maximumSelectedSources === 8 &&
        contract.selectionProtocol.requestScopeBeforeClaimCoverageRequired === true &&
        contract.selectionProtocol.claimCoverageBeforeMinimizationRequired === true &&
        contract.selectionProtocol.relationSidePreservationRequired === true &&
        contract.provider.maximumStructuredOutputFramingToolsPerInvocation === 1 &&
        contract.provider.cumulativeMaximumProviderInvocationsIncludingPredecessors === 251 &&
        contract.failureDiagnostics.selectionViolationCodesRequired === true &&
        contract.failureDiagnostics.selectionViolationCodeSource === "provider_neutral_parser" &&
        contract.failureDiagnostics.rawProviderOutputRetained === false &&
        contract.failureDiagnostics.priorFailureReclassificationAuthorized === false &&
        contract.selectionProtocol.output === "structured_exact_e4_token_array") ||
      (contract.sourcePopulation.coordinatePrefix === "psv18" &&
        contract.sourcePopulation.repetitionStart === 1 &&
        contract.sourcePopulation.expectedRepetitionsPerCase === 4 &&
        contract.selectionProtocol.maximumSelectedSources === 8 &&
        contract.selectionProtocol.requestScopeBeforeClaimCoverageRequired === true &&
        contract.selectionProtocol.claimCoverageBeforeMinimizationRequired === true &&
        contract.selectionProtocol.relationSidePreservationRequired === true &&
        contract.provider.maximumStructuredOutputFramingToolsPerInvocation === 1 &&
        contract.provider.cumulativeMaximumProviderInvocationsIncludingPredecessors === 283 &&
        contract.failureDiagnostics.selectionViolationCodesRequired === true &&
        contract.failureDiagnostics.selectionViolationCodeSource === "provider_neutral_parser" &&
        contract.failureDiagnostics.rawProviderOutputRetained === false &&
        contract.failureDiagnostics.priorFailureReclassificationAuthorized === false &&
        contract.selectionProtocol.output === "structured_exact_e4_token_array"),
    "The provider-shadow v3 correction boundary is invalid.",
  );
  assert(
    contract.candidateEnvelope.expectedMaximumCandidateSources ===
      (claimCoverageMicroPilot
        ? 11
        : [
              "ADR-0258",
              "ADR-0260",
              "ADR-0264",
              "ADR-0266",
              "ADR-0268",
              "ADR-0269",
              "ADR-0271",
              "ADR-0273",
              "ADR-0274",
              "ADR-0276",
            ].includes(contract.decisionId)
          ? 14
          : 16) &&
      contract.candidateEnvelope.expectedMaximumProviderVisibleSourceBytes ===
        (claimCoverageMicroPilot
          ? 85_922
          : requestScopedClaimCoverageMicroPilot
            ? 97_037
            : ["ADR-0258", "ADR-0260", "ADR-0264", "ADR-0266", "ADR-0268", "ADR-0276"].includes(
                  contract.decisionId,
                )
              ? 117_813
              : 130_302) &&
      contract.candidateEnvelope.maximumProviderVisibleSourceBytesPerCall === 262_144,
    "The provider-shadow candidate bounds are invalid.",
  );
  assert(
    contract.observation.maximumPilots ===
      (contract.decisionId === "ADR-0255"
        ? 2
        : contract.decisionId === "ADR-0256"
          ? 3
          : contract.decisionId === "ADR-0257"
            ? 4
            : contract.decisionId === "ADR-0258"
              ? 5
              : contract.decisionId === "ADR-0259"
                ? 6
                : contract.decisionId === "ADR-0260"
                  ? 7
                  : contract.decisionId === "ADR-0261"
                    ? 8
                    : contract.decisionId === "ADR-0262"
                      ? 9
                      : contract.decisionId === "ADR-0264"
                        ? 10
                        : contract.decisionId === "ADR-0265"
                          ? 11
                          : contract.decisionId === "ADR-0266"
                            ? 12
                            : contract.decisionId === "ADR-0268"
                              ? 13
                              : contract.decisionId === "ADR-0269"
                                ? 14
                                : contract.decisionId === "ADR-0271"
                                  ? 15
                                  : contract.decisionId === "ADR-0273"
                                    ? 16
                                    : contract.decisionId === "ADR-0274"
                                      ? 17
                                      : 18) &&
      contract.observation.maximumActivePilots === 1 &&
      contract.observation.maximumObservations === expectedProviderObservationCount,
    "The provider-shadow retention bounds are invalid.",
  );
  assert(
    JSON.stringify(contract.nonResumability.terminalStateKinds) ===
      JSON.stringify(providerShadowV2TerminalStateKinds) &&
      contract.nonResumability.anyTerminalStateRefusesExecution === true &&
      contract.nonResumability.additionalProviderCallsAuthorizedByRecovery === 0,
    "The provider-shadow non-resumability boundary is invalid.",
  );

  return {
    contract,
    contractBytes,
    contractDigest,
    suite,
    suiteBytes,
    eligibleCases,
    executionCases,
  };
}
