import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { stableJson, valueDigest } from "./linked-evidence-shadow-phase-a-pilot-contract.mjs";
import { validateRecentManagedCanaryCheckpoint } from "./linked-evidence-managed-canary-recent-checkpoints.mjs";
import {
  managedCanaryCheckpointContractPath,
  managedCanaryCheckpointDescriptor,
} from "./linked-evidence-managed-canary-checkpoint-versions.mjs";

export * from "./linked-evidence-managed-canary-checkpoint-versions.mjs";

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function repositoryPath(repositoryRoot, requestedPath) {
  assert(!isAbsolute(requestedPath), "The managed canary checkpoint path must be relative.");
  const path = resolve(repositoryRoot, requestedPath);
  assert(
    relative(repositoryRoot, path) !== ".." && !relative(repositoryRoot, path).startsWith("../"),
    "The managed canary checkpoint path escapes the repository.",
  );
  return path;
}

function coordinate(prefix, value) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

export function createManagedCanaryCheckpointSchedule(contract, sourceSchedule) {
  const selectedCases = new Set(contract.sourcePopulation.selectedCaseIds);
  const selectedRepetitions = new Set(contract.sourcePopulation.selectedRepetitions);
  const selected = sourceSchedule.filter(
    (item) => selectedCases.has(item.caseId) && selectedRepetitions.has(item.repetition),
  );
  const sourceTasks = new Set(selected.map((item) => item.sourceSampleId));
  assert(
    selected.length === contract.sourcePopulation.taskRunCount &&
      sourceTasks.size === contract.sourcePopulation.sourceTaskCount,
    "The managed canary source schedule differs from the reviewed population.",
  );
  return selected.map((item, index) => {
    const identity = `${contract.checkpointId}:${item.provider}:${item.caseId}:${item.repetition}`;
    const arm = contract.providers.arms.find((candidate) => candidate.provider === item.provider);
    assert(
      arm !== undefined && arm.model === item.model,
      "The managed canary provider arm differs from the source schedule.",
    );
    return {
      ordinal: index + 1,
      sourceSampleId: item.sourceSampleId,
      caseId: item.caseId,
      repetition: item.repetition,
      provider: item.provider,
      model: item.model,
      ...(arm.selectionTransport === undefined
        ? {}
        : { selectionTransport: structuredClone(arm.selectionTransport) }),
      runId: coordinate("run", identity),
      selectionAttemptId: coordinate("lsel", identity),
      searchNonce: createHash("sha256").update(`${identity}:search`).digest("hex").slice(0, 32),
      observedAt: new Date(
        Date.parse(contract.preparation.observedAtStart) + index * 1_000,
      ).toISOString(),
      expectedDocumentIds: [...item.expectedDocumentIds],
      sourceReceiptDigest: item.sourceReceiptDigest,
    };
  });
}

export async function loadManagedCanaryCheckpointContract(
  repositoryRoot,
  requestedPath = managedCanaryCheckpointContractPath,
) {
  const bytes = await readFile(repositoryPath(repositoryRoot, requestedPath));
  const contractDigest = sha256(bytes);
  const descriptor = managedCanaryCheckpointDescriptor(requestedPath);
  assert(descriptor !== null, "The managed canary checkpoint version is not registered.");
  const { version, reviewedDigest, checkpointId, decisionId } = descriptor;
  assert(
    contractDigest === reviewedDigest,
    "The managed canary checkpoint contract differs from the reviewed bytes.",
  );
  const contract = JSON.parse(bytes.toString("utf8"));
  assert(
    contract.schemaVersion === 1 &&
      contract.checkpointId === checkpointId &&
      contract.decisionId === decisionId &&
      contract.authorization.status === "prepared_for_review" &&
      contract.authorization.providerCallsAuthorized === false &&
      contract.authorization.managedContextEffectsAuthorized === false &&
      contract.authorization.productionActivationAuthorized === false &&
      contract.predecessor.enabledByDefault === false &&
      contract.predecessor.operationalSearchEngine === "lexical-v1" &&
      contract.predecessor.retry === false &&
      contract.sourcePopulation.registeredDocumentCount === 286 &&
      contract.sourcePopulation.sourceTaskCount === 8 &&
      contract.sourcePopulation.taskRunCount === 16 &&
      stableJson(contract.sourcePopulation.selectedRepetitions) === stableJson([1, 2]) &&
      contract.selection.maximumRecommendations === 3 &&
      contract.selection.maximumCandidates === 8 &&
      contract.selection.maximumProviderVisibleSourceBytes === 117_813 &&
      contract.selection.maximumSelectionCallsPerRun === (version >= 3 ? 0 : 1) &&
      contract.selection.maximumRetries === 0 &&
      contract.selection.maximumRepairTurns === 0 &&
      contract.selection.maximumFallbackCalls === 0 &&
      contract.task.executionMode === "read_only" &&
      contract.task.writesAuthorized === false &&
      contract.task.externalMessagesAuthorized === false &&
      contract.task.hubEffectsAuthorized === false &&
      contract.task.directTerminalEffectsAuthorized === false &&
      contract.providers.maximumTaskRuns === 16 &&
      contract.providers.maximumSelectionCalls === (version >= 3 ? 0 : 16) &&
      contract.providers.maximumTaskCalls === 16 &&
      contract.providers.maximumProviderCalls === (version >= 3 ? 16 : 32) &&
      contract.providers.arms.length === 2 &&
      contract.providers.arms.every(
        (arm) =>
          arm.taskRuns === 8 &&
          arm.maximumSelectionCalls === (version >= 3 ? 0 : 8) &&
          arm.maximumTaskCalls === 8,
      ) &&
      contract.preparation.sourceRevisionBinding ===
        "root_head_working_tree_status_and_built_cli_digest" &&
      contract.preparation.providerCalls === 0 &&
      contract.preparation.executionAuthorized === false &&
      contract.acceptance.requiredCompletedRuns === 16 &&
      contract.acceptance.maximumAllowlistedFailures === 0 &&
      contract.acceptance.maximumPrivacyViolations === 0 &&
      contract.acceptance.requiredSourceRecall === 1 &&
      contract.acceptance.minimumPerRunReferencePrecision === 0.5 &&
      contract.acceptance.minimumMeanReferencePrecisionPerProvider === 0.65 &&
      contract.retention.maximumPilots === version &&
      contract.retention.maximumPreparedManifests === 1,
    "The managed canary checkpoint violates the reviewed default-off bounds.",
  );
  if (version === 18) {
    for (const artifact of [
      ...contract.runtime.claimEligibilitySources,
      ...contract.runtime.executionBoundarySources,
    ]) {
      const artifactBytes = await readFile(repositoryPath(repositoryRoot, artifact.path));
      assert(
        sha256(artifactBytes) === artifact.digest,
        `The managed canary v${version} claim-eligibility source differs from the reviewed bytes.`,
      );
    }
  }
  if (version === 2) {
    const codex = contract.providers.arms.find((arm) => arm.provider === "codex");
    const claude = contract.providers.arms.find((arm) => arm.provider === "claude");
    assert(
      contract.preparation.workstreamRevision === 225 &&
        contract.preparation.workstreamTitle ===
          "Prepare exact managed-context canary v2 checkpoint" &&
        contract.terminalPredecessor.checkpointId ===
          "linked-evidence-managed-canary-v1-prepared-20260829" &&
        contract.terminalPredecessor.preparedManifestDigest ===
          "sha256:79e872f22eb072e0e75e8292ccff386f683b8979b61a016f49128e5cb60c6182" &&
        contract.terminalPredecessor.failureRecordId === "lcanary_0c3d6b1574a0807612597531" &&
        contract.terminalPredecessor.failureRecordFileDigest ===
          "sha256:19f96b1359ce5976fa03be50e824682274fd126d1828a950505243c52218b60a" &&
        contract.terminalPredecessor.terminallyStopped === true &&
        contract.terminalPredecessor.resume === false &&
        contract.terminalPredecessor.retry === false &&
        contract.terminalPredecessor.repair === false &&
        contract.terminalPredecessor.replacementRuns === false &&
        codex?.model === "gpt-5.6-sol" &&
        stableJson(codex.selectionTransport) ===
          stableJson({
            kind: "responses_api_no_tools",
            endpoint: "https://api.openai.com/v1/responses",
            tools: [],
            toolChoice: "none",
            store: false,
            maximumOutputTokens: 512,
          }) &&
        claude?.model === "opus" &&
        stableJson(claude.selectionTransport) ===
          stableJson({ kind: "claude_sdk_no_tools", tools: [] }),
      "The managed canary v2 checkpoint violates the reviewed transport or predecessor binding.",
    );
  }
  if (version === 3) {
    const codex = contract.providers.arms.find((arm) => arm.provider === "codex");
    const claude = contract.providers.arms.find((arm) => arm.provider === "claude");
    assert(
      contract.preparation.workstreamRevision === 227 &&
        contract.preparation.workstreamTitle === "Prepare API-key-free managed-context canary v3" &&
        contract.selection.kind === "reviewed_provider_shadow_v18_projection" &&
        contract.selection.projectionRule ===
          "retain_exact_v18_provider_selection_only_when_present_in_current_managed_linked_candidate_projection" &&
        contract.supersededPredecessor.checkpointId ===
          "linked-evidence-managed-canary-v2-prepared-20260829" &&
        contract.supersededPredecessor.preparedManifestDigest ===
          "sha256:fa13efc7a6473b7077a4bc823e24244565166f8da5a77e5d74c95ddee475d110" &&
        contract.supersededPredecessor.providerCalls === 0 &&
        contract.supersededPredecessor.executionAuthorized === false &&
        contract.credentials.userApiKeysRequired === false &&
        contract.credentials.optionalByokSelectionTransportInPrimaryPath === false &&
        codex?.model === "gpt-5.6-sol" &&
        codex.taskTransport === "provider_native_signed_in_session" &&
        claude?.model === "opus" &&
        claude.taskTransport === "provider_native_signed_in_session" &&
        !contract.providers.arms.some((arm) => "selectionTransport" in arm),
      "The managed canary v3 checkpoint violates the reviewed native-session or frozen-selection binding.",
    );
  }
  if (version === 4) {
    const codex = contract.providers.arms.find((arm) => arm.provider === "codex");
    const claude = contract.providers.arms.find((arm) => arm.provider === "claude");
    assert(
      contract.preparation.workstreamRevision === 228 &&
        contract.preparation.workstreamTitle ===
          "Reject ineffective frozen-selection v3 and prepare deterministic v4" &&
        contract.selection.kind === "deterministic_all_current_linked_candidates_v1" &&
        contract.selection.policyId === "managed-linked-evidence-all-candidates-v1" &&
        contract.selection.rule ===
          "select_all_current_managed_linked_candidates_in_projection_order" &&
        contract.selection.minimumSelectionsPerRun === 1 &&
        contract.rejectedPredecessor.checkpointId ===
          "linked-evidence-managed-canary-v3-native-session-20260829" &&
        contract.rejectedPredecessor.preparedManifestDigest ===
          "sha256:b93952d09b44e77223cd5b217480e0af1dda748ae548d0dc65ca1e3717dbf0cc" &&
        contract.rejectedPredecessor.providerCalls === 0 &&
        contract.rejectedPredecessor.codexProjectedSelectionCount === 0 &&
        contract.rejectedPredecessor.claudeProjectedSelectionCount === 1 &&
        contract.credentials.userApiKeysRequired === false &&
        contract.credentials.optionalByokSelectionTransportInPrimaryPath === false &&
        codex?.model === "gpt-5.6-sol" &&
        codex.taskTransport === "provider_native_signed_in_session" &&
        claude?.model === "opus" &&
        claude.taskTransport === "provider_native_signed_in_session" &&
        !contract.providers.arms.some((arm) => "selectionTransport" in arm),
      "The managed canary v4 checkpoint violates the deterministic selection or native-session binding.",
    );
  }
  if (version === 5) {
    const codex = contract.providers.arms.find((arm) => arm.provider === "codex");
    const claude = contract.providers.arms.find((arm) => arm.provider === "claude");
    assert(
      contract.preparation.workstreamRevision === 230 &&
        contract.preparation.workstreamTitle ===
          "Prepare exact deterministic native-session canary v5" &&
        contract.selection.kind === "deterministic_all_current_linked_candidates_v1" &&
        contract.selection.policyId === "managed-linked-evidence-all-candidates-v1" &&
        contract.selection.policyDigest ===
          "sha256:8063ff4d0c1825b3abe35f81a53f245b988b8c6ea1e0cdacf2a690bbea76cb18" &&
        contract.preparationPredecessor.checkpointId ===
          "linked-evidence-managed-canary-v4-deterministic-20260829" &&
        contract.preparationPredecessor.preparedManifestDigest ===
          "sha256:c3a5983fc19b0543e5a951a7dca19d89a89c1300e6e146a81dd107441ebef8ba" &&
        contract.preparationPredecessor.providerCalls === 0 &&
        contract.preparationPredecessor.nonemptySelectionRuns === 16 &&
        contract.runtime.selectionAdapterCreationsPerRun === 0 &&
        contract.runtime.canaryRecordSchemaVersion === 2 &&
        contract.runtime.legacyRecordSchemaVersionPreserved === 1 &&
        contract.runtime.deterministicSelectionAdapterReceipt === null &&
        contract.runtime.deterministicSelectionUsage === null &&
        contract.credentials.userApiKeysRequired === false &&
        contract.credentials.optionalByokSelectionTransportInPrimaryPath === false &&
        codex?.model === "gpt-5.6-sol" &&
        codex.taskTransport === "provider_native_signed_in_session" &&
        claude?.model === "opus" &&
        claude.taskTransport === "provider_native_signed_in_session" &&
        !contract.providers.arms.some((arm) => "selectionTransport" in arm),
      "The managed canary v5 checkpoint violates the verified runtime or native-session binding.",
    );
  }
  validateRecentManagedCanaryCheckpoint(contract, version);
  return { contract, contractDigest, contractValueDigest: valueDigest(contract) };
}
