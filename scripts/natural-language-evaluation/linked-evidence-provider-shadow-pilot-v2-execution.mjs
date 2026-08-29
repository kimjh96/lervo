import { chmod, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { observePrimaryBaseline } from "./linked-evidence-provider-shadow-pilot-preparation.mjs";
import {
  assertFreshProviderShadowV2Execution,
  loadPreparedProviderShadowV2Pilot,
} from "./linked-evidence-provider-shadow-pilot-v2-preparation.mjs";
import {
  buildProviderShadowV2ObservedRecord,
  buildProviderShadowV2UnavailableRecord,
  observeProviderShadowV2PrimaryEffects,
} from "./linked-evidence-provider-shadow-pilot-v2-observation.mjs";
import {
  readOwnerJson,
  writeOwnerJsonAtomic,
  writeOwnerJsonImmutable,
} from "./linked-evidence-provider-shadow-pilot-v2-state.mjs";
import { runProviderShadowV2Turn } from "./linked-evidence-provider-shadow-pilot-v2-turn.mjs";

async function stopWithFailure(prepared, journal, runSpec, failureCode) {
  const stopped = {
    ...journal,
    status: "stopped",
    current: { ...journal.current, stage: "stopped", failureCode },
  };
  await writeOwnerJsonAtomic(prepared.paths.attempt, stopped);
  await writeOwnerJsonImmutable(prepared.paths.failure, {
    schemaVersion: 2,
    pilotId: prepared.manifest.pilotId,
    preparedManifestDigest: prepared.manifestDigest,
    status: "stopped",
    shadowOrdinal: runSpec.shadowOrdinal,
    sampleId: runSpec.sampleId,
    provider: runSpec.provider,
    failureCode,
    providerInvocationCount: stopped.providerInvocationCount,
    providerInvocationCounts: stopped.providerInvocationCounts,
  });
  return stopped;
}

export async function executeProviderShadowV2Pilot(
  repositoryRoot,
  contractPath,
  createAdapter,
  selectionCarrier,
  onProgress = () => undefined,
) {
  const prepared = await loadPreparedProviderShadowV2Pilot(repositoryRoot, contractPath);
  await assertFreshProviderShadowV2Execution(prepared);
  await mkdir(prepared.paths.observations, { recursive: true, mode: 0o700 });
  await chmod(prepared.paths.observations, 0o700);
  const materialByDocumentId = new Map(
    prepared.reconstructed.corpus.map((source) => [
      source.sourceId,
      { path: source.path, text: source.text },
    ]),
  );
  let journal = {
    schemaVersion: 2,
    recordKind: prepared.loaded.contract.attemptJournal.recordKind,
    pilotId: prepared.manifest.pilotId,
    preparedManifestDigest: prepared.manifestDigest,
    status: "running",
    providerInvocationCount: 0,
    providerInvocationCounts: Object.fromEntries(
      prepared.loaded.contract.provider.arms.map((arm) => [arm.provider, 0]),
    ),
    completedObservationCount: 0,
    observationDigests: [],
    current: null,
  };

  for (const runSpec of prepared.manifest.schedule) {
    journal = {
      ...journal,
      current: {
        shadowOrdinal: runSpec.shadowOrdinal,
        sourceSampleId: runSpec.sourceSampleId,
        sampleId: runSpec.sampleId,
        provider: runSpec.provider,
        model: runSpec.model,
        stage: "prepared",
        shadowRunId: runSpec.shadowRunId,
        sessionId: runSpec.sessionId,
        targetTurnId: runSpec.targetTurnId,
        providerSessionId: null,
        adapterReceiptId: null,
        providerTurnId: null,
        providerInvocationCount: 0,
      },
    };
    let persisted = await writeOwnerJsonAtomic(prepared.paths.attempt, journal);
    onProgress({
      phase: "shadow_started",
      shadowOrdinal: runSpec.shadowOrdinal,
      provider: runSpec.provider,
      caseId: runSpec.caseId,
    });
    const onBoundary = async (stage, coordinates) => {
      journal = {
        ...journal,
        current: { ...journal.current, ...coordinates, stage },
      };
      persisted = await writeOwnerJsonAtomic(prepared.paths.attempt, journal);
      return persisted;
    };

    let outcome;
    try {
      outcome = await runProviderShadowV2Turn({
        createAdapter,
        provider: runSpec.provider,
        repositoryRoot: prepared.phase.repository,
        projectId: prepared.manifest.projectId,
        model: runSpec.model,
        runSpec,
        materialByDocumentId,
        timeoutMs: prepared.loaded.contract.provider.timeoutMsPerInvocation,
        maximumResultBytes: prepared.loaded.contract.provider.maximumResultBytes,
        maximumSelectedSources: prepared.loaded.contract.selectionProtocol.maximumSelectedSources,
        selectionProtocolId: prepared.loaded.contract.selectionProtocol.protocolId,
        selectionCarrier: selectionCarrier(
          runSpec.provider,
          prepared.loaded.contract.selectionProtocol.output,
        ),
        selectionOutput: prepared.loaded.contract.selectionProtocol.output,
        maximumStructuredOutputFramingTools:
          prepared.loaded.contract.provider.maximumStructuredOutputFramingToolsPerInvocation ?? 0,
        stopConditions: prepared.loaded.contract.stopConditions,
        lastDurableAttemptDigest: persisted.digest,
        onBoundary,
      });
    } catch (error) {
      const rawCode = error instanceof Error ? error.message : "";
      const code = prepared.loaded.contract.stopConditions.includes(rawCode)
        ? rawCode
        : "provider_shadow_adapter_failed";
      const invocationCount =
        error !== null && typeof error === "object" ? (error.providerInvocationCount ?? 0) : 0;
      journal = {
        ...journal,
        providerInvocationCount: journal.providerInvocationCount + invocationCount,
        providerInvocationCounts: {
          ...journal.providerInvocationCounts,
          [runSpec.provider]: journal.providerInvocationCounts[runSpec.provider] + invocationCount,
        },
      };
      await stopWithFailure(prepared, journal, runSpec, code);
      throw new Error(`Provider-shadow v2 stopped at ${runSpec.shadowOrdinal}: ${code}.`, {
        cause: error,
      });
    }

    journal = {
      ...journal,
      providerInvocationCount: journal.providerInvocationCount + outcome.providerInvocationCount,
      providerInvocationCounts: {
        ...journal.providerInvocationCounts,
        [runSpec.provider]:
          journal.providerInvocationCounts[runSpec.provider] + outcome.providerInvocationCount,
      },
      current: {
        ...journal.current,
        outcomeStatus: outcome.status,
        providerFailureCode: outcome.status === "unavailable" ? outcome.failureCode : null,
        selectionViolationCodes:
          outcome.status === "unavailable" ? outcome.selectionViolationCodes : [],
      },
    };
    persisted = await writeOwnerJsonAtomic(prepared.paths.attempt, journal);
    if (
      journal.providerInvocationCount >
        prepared.loaded.contract.provider.maximumProviderInvocations ||
      journal.providerInvocationCounts[runSpec.provider] >
        prepared.loaded.contract.provider.maximumProviderInvocationsPerArm
    ) {
      await stopWithFailure(prepared, journal, runSpec, "provider_shadow_attempt_state_invalid");
      throw new Error("The provider-shadow v2 provider budget was exceeded.");
    }

    const after = await observePrimaryBaseline(prepared.phase.repository, runSpec);
    const effects = observeProviderShadowV2PrimaryEffects(runSpec.primaryBaseline, after);
    if (Object.values(effects).some((value) => !value)) {
      await stopWithFailure(prepared, journal, runSpec, "provider_shadow_primary_effect_detected");
      throw new Error("provider_shadow_primary_effect_detected");
    }
    const observation =
      outcome.status === "observed"
        ? buildProviderShadowV2ObservedRecord(prepared, runSpec, outcome, effects)
        : buildProviderShadowV2UnavailableRecord(prepared, runSpec, outcome, effects);
    const observationPath = resolve(
      prepared.paths.observations,
      `${String(runSpec.shadowOrdinal).padStart(2, "0")}-${runSpec.provider}.json`,
    );
    const storedObservation = await writeOwnerJsonImmutable(observationPath, observation);
    journal = {
      ...journal,
      completedObservationCount: runSpec.shadowOrdinal,
      observationDigests: [...journal.observationDigests, storedObservation.digest],
      current: { ...journal.current, stage: "observation_persisted" },
    };
    await writeOwnerJsonAtomic(prepared.paths.attempt, journal);
    await writeOwnerJsonAtomic(prepared.paths.execution, {
      schemaVersion: 2,
      pilotId: prepared.manifest.pilotId,
      preparedManifestDigest: prepared.manifestDigest,
      completedObservationCount: runSpec.shadowOrdinal,
      providerInvocationCount: journal.providerInvocationCount,
      providerInvocationCounts: journal.providerInvocationCounts,
      status: runSpec.shadowOrdinal === prepared.manifest.schedule.length ? "completed" : "running",
    });
    onProgress({
      phase: "shadow_completed",
      shadowOrdinal: runSpec.shadowOrdinal,
      provider: runSpec.provider,
      status: outcome.status,
      selectedCount: outcome.status === "observed" ? outcome.selected.length : 0,
    });
    if (outcome.status === "unavailable") {
      await stopWithFailure(prepared, journal, runSpec, "provider_shadow_observation_unavailable");
      throw new Error(
        `Provider-shadow v2 stopped at ${runSpec.shadowOrdinal}: provider_shadow_observation_unavailable.`,
      );
    }
  }

  journal = { ...journal, status: "completed", current: { ...journal.current, stage: "stopped" } };
  await writeOwnerJsonAtomic(prepared.paths.attempt, journal);
  return readOwnerJson(prepared.paths.execution);
}
