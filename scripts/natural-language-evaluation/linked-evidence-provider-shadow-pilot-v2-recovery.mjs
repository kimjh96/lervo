import { resolve } from "node:path";

import { observePrimaryBaseline } from "./linked-evidence-provider-shadow-pilot-preparation.mjs";
import { buildProviderShadowV2UnavailableObservation } from "./linked-evidence-provider-shadow-pilot-v2-contract.mjs";
import { loadPreparedProviderShadowV2Pilot } from "./linked-evidence-provider-shadow-pilot-v2-preparation.mjs";
import { validateProviderShadowSelectionViolationCodes } from "./linked-evidence-provider-shadow-pilot-v2-policy.mjs";
import {
  pathExists,
  readOwnerJson,
  writeOwnerJsonAtomic,
  writeOwnerJsonImmutable,
} from "./linked-evidence-provider-shadow-pilot-v2-state.mjs";

function recoveryObservationPath(prepared, runSpec) {
  return resolve(
    prepared.paths.observations,
    `${String(runSpec.shadowOrdinal).padStart(2, "0")}-${runSpec.provider}.json`,
  );
}

export function recoverProviderShadowInvocationCounts(journal, provider) {
  const total = journal.providerInvocationCount;
  const completed = journal.completedObservationCount;
  const byProvider = journal.providerInvocationCounts;
  if (
    !Number.isSafeInteger(total) ||
    !Number.isSafeInteger(completed) ||
    total < 0 ||
    completed < 0 ||
    byProvider === null ||
    typeof byProvider !== "object" ||
    !Number.isSafeInteger(byProvider[provider]) ||
    byProvider[provider] < 0 ||
    (total !== completed && total !== completed + 1)
  ) {
    throw new TypeError("provider_shadow_attempt_state_invalid");
  }
  const increment = total === completed ? 1 : 0;
  return {
    providerInvocationCount: total + increment,
    providerInvocationCounts: {
      ...byProvider,
      [provider]: byProvider[provider] + increment,
    },
  };
}

export async function recoverProviderShadowV2Unavailable(repositoryRoot, contractPath) {
  const prepared = await loadPreparedProviderShadowV2Pilot(repositoryRoot, contractPath);
  if (!(await pathExists(prepared.paths.attempt))) {
    throw new Error("provider_shadow_attempt_state_invalid");
  }
  const journal = await readOwnerJson(prepared.paths.attempt);
  const current = journal.current;
  const runSpec = prepared.manifest.schedule.find(
    (item) => item.shadowOrdinal === current?.shadowOrdinal,
  );
  if (
    journal.status !== "running" ||
    runSpec === undefined ||
    current.providerInvocationCount !== 1 ||
    !new Set(["turn_accepted", "turn_completed"]).has(current.stage)
  ) {
    throw new Error("provider_shadow_attempt_state_invalid");
  }
  const observationPath = recoveryObservationPath(prepared, runSpec);
  if (await pathExists(observationPath)) throw new Error("provider_shadow_attempt_state_invalid");
  const after = await observePrimaryBaseline(prepared.phase.repository, runSpec);
  const effects = {
    primaryContextUnchanged:
      after.contextEventDigest === runSpec.primaryBaseline.contextEventDigest,
    primaryOutputUnchanged: after.outputDigest === runSpec.primaryBaseline.outputDigest,
    managedWritesUnchanged:
      after.repositoryStatusDigest === runSpec.primaryBaseline.repositoryStatusDigest,
    verificationUnchanged: after.verificationDigest === runSpec.primaryBaseline.verificationDigest,
    publicationUnchanged: after.publicationDigest === runSpec.primaryBaseline.publicationDigest,
    e1ThroughE4EventsUnchanged:
      after.contextEventDigest === runSpec.primaryBaseline.contextEventDigest,
  };
  const coordinatePrefix = prepared.loaded.contract.sourcePopulation.coordinatePrefix ?? "psv2";
  const recoveredCounts = recoverProviderShadowInvocationCounts(journal, runSpec.provider);
  const recoveredProviderInvocationCount = recoveredCounts.providerInvocationCount;
  const recoveredProviderInvocationCounts = recoveredCounts.providerInvocationCounts;
  if (
    recoveredProviderInvocationCount >
      prepared.loaded.contract.provider.maximumProviderInvocations ||
    recoveredProviderInvocationCounts[runSpec.provider] >
      prepared.loaded.contract.provider.maximumProviderInvocationsPerArm
  ) {
    throw new Error("provider_shadow_attempt_state_invalid");
  }
  const unavailable = buildProviderShadowV2UnavailableObservation({
    observationId: `${coordinatePrefix}obs_recovered_${String(runSpec.shadowOrdinal).padStart(2, "0")}`,
    sampleId: runSpec.sampleId,
    availabilityStage: current.stage,
    missingCoordinates: ["providerSessionId", "adapterReceiptId", "providerTurnId"].filter(
      (field) => current[field] === null,
    ),
    failureCode: "provider_shadow_observation_unavailable",
    lastDurableAttemptDigest: (await writeOwnerJsonAtomic(prepared.paths.attempt, journal)).digest,
    providerInvocationCount: 1,
    providerSessionId: current.providerSessionId,
    adapterReceiptId: current.adapterReceiptId,
    providerTurnId: current.providerTurnId,
  }).record;
  const observation = {
    ...unavailable,
    recordId: unavailable.observationId,
    schemaVersion: 2,
    pilotId: prepared.manifest.pilotId,
    projectId: prepared.manifest.projectId,
    sourceSampleId: runSpec.sourceSampleId,
    sourceRunId: runSpec.sourceRunId,
    shadowRunId: runSpec.shadowRunId,
    sessionId: runSpec.sessionId,
    adapterId: null,
    provider: runSpec.provider,
    model: runSpec.model,
    targetTurnId: runSpec.targetTurnId,
    sourceManifestDigest: prepared.manifest.sourcePhaseAManifestDigest,
    sourceSnapshotDigest: prepared.manifest.sourceSnapshotDigest,
    suiteDigest: prepared.manifest.sourceSuiteDigest,
    selectionProtocolDigest: prepared.loaded.contract.selectionProtocol.protocolDigest,
    candidateEnvelopeDigest: runSpec.candidateEnvelopeDigest,
    requestDigest: null,
    shadowOrdinal: runSpec.shadowOrdinal,
    sourceShadowOrdinal: runSpec.sourceShadowOrdinal,
    sourceOrdinal: runSpec.sourceOrdinal,
    caseId: runSpec.caseId,
    repetition: runSpec.repetition,
    candidateCount: runSpec.candidateCount,
    candidates: runSpec.candidates,
    providerVisibleSourceBytes: runSpec.providerVisibleSourceBytes,
    terminalStatus: "unavailable",
    providerFailureCode: current.providerFailureCode ?? "provider_shadow_attempt_state_invalid",
    selectionViolationCodes: validateProviderShadowSelectionViolationCodes(
      current.selectionViolationCodes ?? [],
    ),
    ...effects,
  };
  const stored = await writeOwnerJsonImmutable(observationPath, observation);
  const recovery = {
    schemaVersion: 2,
    pilotId: prepared.manifest.pilotId,
    status: "materialized_unavailable_and_stopped",
    shadowOrdinal: runSpec.shadowOrdinal,
    sampleId: runSpec.sampleId,
    provider: runSpec.provider,
    providerCalls: 0,
    observationDigest: stored.digest,
  };
  await writeOwnerJsonImmutable(prepared.paths.recovery, recovery);
  await writeOwnerJsonImmutable(prepared.paths.failure, {
    ...recovery,
    status: "stopped",
    failureCode: "provider_shadow_observation_unavailable",
    providerInvocationCount: recoveredProviderInvocationCount,
    providerInvocationCounts: recoveredProviderInvocationCounts,
  });
  await writeOwnerJsonAtomic(prepared.paths.attempt, {
    ...journal,
    status: "stopped",
    providerInvocationCount: recoveredProviderInvocationCount,
    providerInvocationCounts: recoveredProviderInvocationCounts,
    completedObservationCount: journal.completedObservationCount + 1,
    observationDigests: [...journal.observationDigests, stored.digest],
    current: {
      ...current,
      stage: "stopped",
      failureCode: "provider_shadow_observation_unavailable",
    },
  });
  return recovery;
}
