import { chmod, mkdir, readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import {
  loadProviderShadowV2Contract,
  createProviderShadowV2AttemptSchedule,
  providerShadowV2ExecutionDisposition,
  validateProviderShadowV2Candidate,
} from "./linked-evidence-provider-shadow-pilot-v2-contract.mjs";
import {
  phaseAPaths,
  reconstructProviderShadowSchedule,
  repositoryStatusDigest,
} from "./linked-evidence-provider-shadow-pilot-preparation.mjs";
import {
  providerShadowV2Paths,
  providerShadowV2StateCounts,
  readOwnerJson,
  writeOwnerJsonImmutable,
} from "./linked-evidence-provider-shadow-pilot-v2-state.mjs";
import { stableJson, valueDigest } from "./linked-evidence-shadow-phase-a-pilot-contract.mjs";

const authorizedWorkstreams = {
  "ADR-0255": {
    workstreamId: "wks_715d83744a212f47e5c6555c",
    revision: 155,
    title: "Exact paired Codex-Claude provider-shadow v2 authorized",
    contractDigest: "sha256:2e672fd36dbd9d3521a95394f29f78782fbb66e5bd52ca7459a25d2a883342f4",
  },
  "ADR-0256": {
    workstreamId: "wks_715d83744a212f47e5c6555c",
    revision: 157,
    title: "Exact paired Codex-Claude provider-shadow v3 authorized",
    contractDigest: "sha256:e877622dcb06c4b5963e0fd9ebb2e1e7b23067bf6353672bbfeea20b048556fc",
  },
  "ADR-0257": {
    workstreamId: "wks_715d83744a212f47e5c6555c",
    revision: 159,
    title: "Exact paired Codex-Claude provider-shadow v4 authorized",
    contractDigest: "sha256:08ab9c78a785d6967f0ce10c590390c05b38f99cbb807f835648571808e4f9d3",
  },
  "ADR-0258": {
    workstreamId: "wks_715d83744a212f47e5c6555c",
    revision: 162,
    title: "Exact Claude structured-selection micro-pilot v5 authorized",
    contractDigest: "sha256:34f0211e514edd367ed7a310c123de02f9f5e05354a814ac9ebcbae59758f77c",
  },
  "ADR-0259": {
    workstreamId: "wks_715d83744a212f47e5c6555c",
    revision: 163,
    title: "Exact durable Claude structured-selection micro-pilot v6 authorized",
    contractDigest: "sha256:05f0747db9e888f3fc5500c873a9d56cce4e13545d470570eac63e7e74d46947",
  },
  "ADR-0260": {
    workstreamId: "wks_715d83744a212f47e5c6555c",
    revision: 164,
    title: "Exact Claude output-framing micro-pilot v7 authorized",
    contractDigest: "sha256:0a7d6f913bcc9b09a20ff2ad62e6b895a6eda16ea9d0b540985886fc45d6614f",
  },
  "ADR-0261": {
    workstreamId: "wks_715d83744a212f47e5c6555c",
    revision: 165,
    title: "Exact two-source Claude micro-pilot v8 authorized",
    contractDigest: "sha256:765cba530a02fdf1beaab5a27333bf6684922b768eeb27bf885542beb1a67eac",
  },
  "ADR-0262": {
    workstreamId: "wks_715d83744a212f47e5c6555c",
    revision: 168,
    title: "Exact paired Codex-Claude minimal-sufficient micro-pilot v9 authorized",
    contractDigest: "sha256:14d72e8dab12ba6124df7880448748b507d2fb9d468d988e68999e5a2a36bf9b",
  },
  "ADR-0264": {
    workstreamId: "wks_715d83744a212f47e5c6555c",
    revision: 174,
    title: "Exact unambiguous Codex-Claude provider-shadow v10 authorized",
    contractDigest: "sha256:827d7f67528d6bdc10215f48a6114ffb720d4f563a62e4dce14f5c62698c4ffc",
  },
  "ADR-0265": {
    workstreamId: "wks_715d83744a212f47e5c6555c",
    revision: 177,
    title: "Exact claim-coverage Codex-Claude provider-shadow v11 authorized",
    contractDigest: "sha256:4d4c5a762e04c2379fe206aeb410b1a4e83fffde631af88333c5a9523a6b0bd1",
  },
  "ADR-0266": {
    workstreamId: "wks_715d83744a212f47e5c6555c",
    revision: 179,
    title: "Exact four-case claim-coverage Codex-Claude v12 authorized",
    contractDigest: "sha256:bafc9b982445d32f6d09ea4601b489a9ea0b968e474f5df269192f513e03cd74",
  },
  "ADR-0268": {
    workstreamId: "wks_715d83744a212f47e5c6555c",
    revision: 184,
    title: "Exact diagnostic Codex-Claude provider-shadow v13 authorized",
    contractDigest: "sha256:e6db21bed98165d53acd916504a0b5acd61a8c8fae88f90571aecefea370d944",
  },
  "ADR-0269": {
    workstreamId: "wks_715d83744a212f47e5c6555c",
    revision: 191,
    title: "Exact request-scoped Codex-Claude provider-shadow v14 authorized",
    contractDigest: "sha256:037e952ea95358d851786b06528e9aa2a2a1acaeba3d3d7c7ed4a66cab40eed6",
  },
  "ADR-0271": {
    workstreamId: "wks_715d83744a212f47e5c6555c",
    revision: 202,
    title: "Exact structured-carrier Codex-Claude provider-shadow v15 authorized",
    contractDigest: "sha256:fe1b4852fd4c532bee816defe020081bd1db6078e8524996af95cde8cadb2202",
  },
  "ADR-0273": {
    workstreamId: "wks_715d83744a212f47e5c6555c",
    revision: 204,
    title: "Exact compatible-carrier Codex-Claude provider-shadow v16 authorized",
    contractDigest: "sha256:7520a5ed8a3801c288250269468a6e6be333bc2c37a2712de5a9771ff62c9efe",
  },
  "ADR-0274": {
    workstreamId: "wks_715d83744a212f47e5c6555c",
    revision: 206,
    title: "Exact relational-coverage Codex-Claude provider-shadow v17 authorized",
    contractDigest: "sha256:12287835555004972086111f9b0f013cc848de387d75b457fe385cfc7537d746",
  },
  "ADR-0276": {
    workstreamId: "wks_715d83744a212f47e5c6555c",
    revision: 209,
    title: "Exact four-case relational Codex-Claude confirmation v18 authorized",
    contractDigest: "sha256:b6e8a1f1898c13d815c63d0b4446e6c170c9e595f18dee171e49a4fb638ae4af",
  },
};

function scheduleKey(item) {
  return `${item.caseId}\u0000${item.repetition}`;
}

function bindFreshCoordinates(contract, eligibleCases, reconstructedSchedule) {
  const fresh = createProviderShadowV2AttemptSchedule(contract, eligibleCases);
  const reconstructedByKey = new Map(
    reconstructedSchedule.map((item) => [scheduleKey(item), item]),
  );
  const schedule = fresh.map((coordinates, index) => {
    const item = reconstructedByKey.get(scheduleKey(coordinates));
    if (item === undefined) throw new Error("provider_shadow_manifest_drift");
    return {
      ...item,
      sourceShadowOrdinal: item.shadowOrdinal,
      shadowOrdinal: index + 1,
      sourceSampleId: coordinates.sourceSampleId,
      sampleId: coordinates.sampleId,
      provider: coordinates.provider,
      model: coordinates.model,
      shadowRunId: coordinates.shadowRunId,
      sessionId: coordinates.sessionId,
      targetTurnId: coordinates.targetTurnId,
      candidates: item.candidates.map(validateProviderShadowV2Candidate),
    };
  });
  if (
    schedule.length !== fresh.length ||
    new Set(schedule.map((item) => item.sampleId)).size !== fresh.length
  ) {
    throw new Error("provider_shadow_manifest_drift");
  }
  return schedule;
}

async function readExecutionAuthority(repositoryRoot, contract) {
  const authorizedWorkstream = authorizedWorkstreams[contract.decisionId];
  if (authorizedWorkstream === undefined) throw new Error("provider_shadow_authority_missing");
  const authority = JSON.parse(
    await readFile(resolve(repositoryRoot, ".lervo/state/workstreams/current.json"), "utf8"),
  );
  if (
    authority.workstreamId !== authorizedWorkstream.workstreamId ||
    authority.revision !== authorizedWorkstream.revision ||
    authority.title !== authorizedWorkstream.title ||
    contract.contractDigest !== authorizedWorkstream.contractDigest ||
    authority.pendingDecisions.length !== 0 ||
    !authority.objective.includes(String(contract.maximumProviderInvocations)) ||
    !authority.notes.some((note) => note.includes("Claude")) ||
    !authority.notes.some((note) => note.includes(String(contract.cumulativeMaximum)))
  ) {
    throw new Error("provider_shadow_authority_missing");
  }
  return authority;
}

export async function prepareProviderShadowV2Pilot(repositoryRoot, contractPath) {
  const loaded = await loadProviderShadowV2Contract(repositoryRoot, contractPath);
  const authority = await readExecutionAuthority(repositoryRoot, {
    decisionId: loaded.contract.decisionId,
    contractDigest: loaded.contractDigest,
    cumulativeMaximum:
      loaded.contract.provider.cumulativeMaximumProviderInvocationsIncludingPredecessors ??
      loaded.contract.provider.cumulativeMaximumProviderInvocationsIncludingV2 ??
      loaded.contract.provider.maximumProviderInvocations,
    maximumProviderInvocations: loaded.contract.provider.maximumProviderInvocations,
  });
  const paths = providerShadowV2Paths(repositoryRoot, loaded.contract.pilotId);
  await mkdir(paths.pilotsRoot, { recursive: true, mode: 0o700 });
  await chmod(paths.pilotsRoot, 0o700);
  const retainedPilots = (await readdir(paths.pilotsRoot, { withFileTypes: true })).filter((item) =>
    item.isDirectory(),
  );
  if (retainedPilots.length >= loaded.contract.observation.maximumPilots) {
    throw new Error("The provider-shadow retention bound is already full.");
  }

  const phase = phaseAPaths(repositoryRoot, loaded.contract.sourcePopulation.phaseAPilotId);
  const reconstructed = await reconstructProviderShadowSchedule(repositoryRoot, loaded, phase);
  const schedule = bindFreshCoordinates(
    loaded.contract,
    loaded.executionCases,
    reconstructed.schedule,
  );
  const maximumCandidateSources = Math.max(...schedule.map((item) => item.candidateCount));
  const maximumProviderVisibleSourceBytes = Math.max(
    ...schedule.map((item) => item.providerVisibleSourceBytes),
  );
  if (
    schedule.length !== loaded.contract.sourcePopulation.expectedProviderObservationCount ||
    maximumCandidateSources !== loaded.contract.candidateEnvelope.expectedMaximumCandidateSources ||
    maximumProviderVisibleSourceBytes !==
      loaded.contract.candidateEnvelope.expectedMaximumProviderVisibleSourceBytes ||
    maximumProviderVisibleSourceBytes >
      loaded.contract.candidateEnvelope.maximumProviderVisibleSourceBytesPerCall
  ) {
    throw new Error("provider_shadow_candidate_drift");
  }
  const manifest = {
    schemaVersion: 2,
    pilotId: loaded.contract.pilotId,
    projectId: reconstructed.phasePrepared.manifest.projectId,
    preparedAt: new Date().toISOString(),
    contractDigest: loaded.contractDigest,
    authority: {
      workstreamId: authority.workstreamId,
      revision: authority.revision,
      snapshotDigest: valueDigest(authority),
      choiceId: "authorize_exact_shadow_v2",
      maximumProviderInvocations: loaded.contract.provider.maximumProviderInvocations,
    },
    providerCalls: 0,
    providers: loaded.contract.provider.arms,
    sourcePhaseAManifestDigest: reconstructed.phasePrepared.manifestDigest,
    sourceSnapshotDigest: valueDigest(reconstructed.phasePrepared.manifest.sourceSnapshot),
    sourceSuiteDigest: loaded.contract.groundTruth.sourceSuiteDigest,
    sourceCorpusDigest: reconstructed.phasePrepared.manifest.corpusDigest,
    phaseRepositoryStatusDigest: repositoryStatusDigest(phase.repository),
    maximumCandidateSources,
    maximumProviderVisibleSourceBytes,
    scheduleDigest: valueDigest(schedule),
    schedule,
  };
  const wrapper = { manifest, manifestDigest: valueDigest(manifest) };
  await writeOwnerJsonImmutable(paths.prepared, wrapper);
  return { loaded, paths, phase, reconstructed, ...wrapper };
}

export async function loadPreparedProviderShadowV2Pilot(repositoryRoot, contractPath) {
  const loaded = await loadProviderShadowV2Contract(repositoryRoot, contractPath);
  const paths = providerShadowV2Paths(repositoryRoot, loaded.contract.pilotId);
  const phase = phaseAPaths(repositoryRoot, loaded.contract.sourcePopulation.phaseAPilotId);
  const wrapper = await readOwnerJson(paths.prepared);
  if (
    valueDigest(wrapper.manifest) !== wrapper.manifestDigest ||
    wrapper.manifest.contractDigest !== loaded.contractDigest ||
    wrapper.manifest.providerCalls !== 0
  ) {
    throw new Error("provider_shadow_manifest_drift");
  }
  const reconstructed = await reconstructProviderShadowSchedule(repositoryRoot, loaded, phase);
  const schedule = bindFreshCoordinates(
    loaded.contract,
    loaded.executionCases,
    reconstructed.schedule,
  );
  if (
    valueDigest(schedule) !== wrapper.manifest.scheduleDigest ||
    stableJson(schedule) !== stableJson(wrapper.manifest.schedule)
  ) {
    throw new Error("provider_shadow_candidate_drift");
  }
  return { loaded, paths, phase, reconstructed, ...wrapper };
}

export async function assertFreshProviderShadowV2Execution(prepared) {
  const counts = await providerShadowV2StateCounts(prepared.paths);
  const disposition = providerShadowV2ExecutionDisposition(counts);
  if (disposition.status !== "fresh") {
    throw new Error("Existing provider-shadow v2 state was preserved; execution cannot resume.");
  }
  return disposition;
}
