import { execFileSync } from "node:child_process";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { openProjectStorage } from "../../packages/project-storage/dist/index.js";
import { LexicalSearchIndex } from "../../packages/search/dist/index.js";
import { loadRegisteredDocumentCorpus } from "../../packages/search-local/dist/index.js";

import { buildLinkedEvidenceReconciliationV8Coverage } from "./linked-evidence-reconciliation-v8-contract.mjs";
import {
  loadProviderShadowContract,
  sha256,
  stableJson,
  valueDigest,
} from "./linked-evidence-provider-shadow-pilot-contract.mjs";

async function ownerJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

export function providerShadowPaths(repositoryRoot, pilotId) {
  const pilotsRoot = resolve(
    repositoryRoot,
    ".lervo/state/search/linked-evidence-provider-shadow-pilots",
  );
  const root = resolve(pilotsRoot, pilotId);
  return {
    pilotsRoot,
    root,
    controller: resolve(root, "controller"),
    observations: resolve(root, "observations"),
    prepared: resolve(root, "controller/prepared.json"),
    execution: resolve(root, "controller/execution.json"),
    failure: resolve(root, "controller/failure.json"),
    review: resolve(root, "controller/review.json"),
  };
}

export function phaseAPaths(repositoryRoot, pilotId) {
  const root = resolve(
    repositoryRoot,
    ".lervo/state/search/linked-evidence-shadow-pilots",
    pilotId,
  );
  return {
    root,
    repository: resolve(root, "repository"),
    prepared: resolve(root, "controller/prepared.json"),
    receipts: resolve(root, "controller/run-receipts.json"),
    review: resolve(root, "controller/review.json"),
  };
}

function lexicalRecommendations(corpus, query, limit) {
  const byId = new Map(corpus.map((source) => [source.sourceId, source]));
  return new LexicalSearchIndex(corpus).search(query, limit).hits.map((hit) => {
    const source = byId.get(hit.source.sourceId);
    if (source === undefined) throw new Error("A lexical source is absent from the bound corpus.");
    return source;
  });
}

function candidateClasses(sources) {
  const byId = new Map();
  for (const [className, items] of sources) {
    for (const source of items) {
      const current = byId.get(source.sourceId) ?? { source, classes: [] };
      if (!current.classes.includes(className)) current.classes.push(className);
      byId.set(source.sourceId, current);
    }
  }
  return [...byId.values()];
}

export function repositoryStatusDigest(repositoryRoot) {
  return sha256(
    execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    }),
  );
}

async function runContextEventDigest(repositoryRoot, runId) {
  const storage = await openProjectStorage(repositoryRoot);
  try {
    return valueDigest(
      storage.events
        .list({ runId, limit: 1000 })
        .filter((event) => event.type.startsWith("context."))
        .map((event) => ({ type: event.type, payload: event.payload })),
    );
  } finally {
    await storage.close();
  }
}

export async function observePrimaryBaseline(phaseRepository, runSpec) {
  const outputBytes = await readFile(resolve(phaseRepository, runSpec.targetPath));
  return {
    contextEventDigest: await runContextEventDigest(phaseRepository, runSpec.sourceRunId),
    outputDigest: sha256(outputBytes),
    repositoryStatusDigest: repositoryStatusDigest(phaseRepository),
    verificationDigest: valueDigest({
      verificationSuiteId: runSpec.verificationSuiteId,
      primaryRunCompleted: runSpec.primaryRunCompleted,
    }),
    publicationDigest: valueDigest({
      writingPublicationStatus: runSpec.writingPublicationStatus,
      writingSemanticEvaluationStatus: runSpec.writingSemanticEvaluationStatus,
      writingEvaluationArtifactId: runSpec.writingEvaluationArtifactId,
    }),
  };
}

export async function reconstructProviderShadowSchedule(repositoryRoot, loaded, phase) {
  const phasePrepared = JSON.parse(await readFile(phase.prepared, "utf8"));
  if (phasePrepared.manifestDigest !== loaded.contract.sourcePopulation.phaseAManifestDigest) {
    throw new Error("provider_shadow_manifest_drift");
  }
  if (valueDigest(phasePrepared.manifest) !== phasePrepared.manifestDigest) {
    throw new Error("provider_shadow_manifest_drift");
  }
  const phaseReview = JSON.parse(await readFile(phase.review, "utf8"));
  const receiptSet = JSON.parse(await readFile(phase.receipts, "utf8"));
  if (
    phaseReview.status !== "passed" ||
    phaseReview.eligibleRunCount !== 30 ||
    phaseReview.nonemptyProjectionCount !== 24 ||
    receiptSet.receipts.length !== 30
  ) {
    throw new Error("provider_shadow_manifest_drift");
  }
  const corpus = await loadRegisteredDocumentCorpus(phase.repository);
  const corpusById = new Map(corpus.map((source) => [source.sourceId, source]));
  const caseById = new Map(loaded.eligibleCases.map((item) => [item.caseId, item]));
  const receiptByOrdinal = new Map(receiptSet.receipts.map((item) => [item.ordinal, item]));
  const scheduleByOrdinal = new Map(
    phasePrepared.manifest.schedule.map((item) => [item.ordinal, item]),
  );
  const schedule = [];
  for (const projection of phasePrepared.manifest.dryRunProjections) {
    if (projection.retainedCount === 0) continue;
    const sourceSchedule = scheduleByOrdinal.get(projection.ordinal);
    const sourceReceipt = receiptByOrdinal.get(projection.ordinal);
    const suiteCase = caseById.get(projection.caseId);
    if (
      sourceSchedule === undefined ||
      sourceReceipt === undefined ||
      suiteCase === undefined ||
      sourceReceipt.caseId !== projection.caseId
    ) {
      throw new Error("provider_shadow_manifest_drift");
    }
    const recommendations = lexicalRecommendations(corpus, suiteCase.query, 5);
    const ordinarySelections = recommendations.slice(0, 3);
    const coverage = buildLinkedEvidenceReconciliationV8Coverage({
      corpus,
      recommendations: ordinarySelections,
      query: suiteCase.query,
      coverage: loaded.suite.coverage,
      searchLexical: lexicalRecommendations,
    });
    const linked = projection.retained.map((item) => {
      const source = corpusById.get(item.documentId);
      if (source === undefined || source.contentHash !== item.contentHash) {
        throw new Error("provider_shadow_candidate_drift");
      }
      return source;
    });
    const coverageSources = coverage.documents.map((document) => {
      const source = corpusById.get(document.documentId);
      if (source === undefined || source.contentHash !== document.contentHash) {
        throw new Error("provider_shadow_candidate_drift");
      }
      return source;
    });
    const candidates = candidateClasses([
      ["recommendation", recommendations],
      ["linked", linked],
      ["coverage", coverageSources],
    ]).map(({ source, classes }) => ({
      documentId: source.sourceId,
      contentHash: source.contentHash,
      byteCount: Buffer.byteLength(source.text, "utf8"),
      classes,
    }));
    const candidateIdsByPath = new Map(
      [...recommendations, ...linked, ...coverageSources].map((source) => [
        source.path,
        source.sourceId,
      ]),
    );
    const expectedDocumentIds = suiteCase.expectedPaths.map((path) => candidateIdsByPath.get(path));
    if (expectedDocumentIds.some((documentId) => documentId === undefined)) {
      throw new Error("provider_shadow_candidate_drift");
    }
    const providerVisibleSourceBytes = candidates.reduce(
      (total, item) => total + item.byteCount,
      0,
    );
    schedule.push({
      shadowOrdinal: schedule.length + 1,
      sourceOrdinal: projection.ordinal,
      caseId: projection.caseId,
      repetition: sourceSchedule.repetition,
      query: sourceSchedule.query,
      sourceRunId: sourceReceipt.runId,
      targetPath: sourceReceipt.targetPath,
      verificationSuiteId: sourceReceipt.verificationSuiteId,
      primaryRunCompleted: sourceReceipt.primaryRunCompleted,
      writingPublicationStatus: sourceReceipt.writingPublicationStatus,
      writingSemanticEvaluationStatus: sourceReceipt.writingSemanticEvaluationStatus,
      writingEvaluationArtifactId: sourceReceipt.writingEvaluationArtifactId,
      sourceReceiptDigest: valueDigest(sourceReceipt),
      recommendationCount: recommendations.length,
      linkedCount: linked.length,
      coverageCount: coverageSources.length,
      candidateCount: candidates.length,
      providerVisibleSourceBytes,
      candidateEnvelopeDigest: valueDigest(candidates),
      candidates,
      expectedDocumentIds,
      primaryBaseline: await observePrimaryBaseline(phase.repository, {
        ...sourceReceipt,
        sourceRunId: sourceReceipt.runId,
      }),
    });
  }
  return { schedule, corpus, phasePrepared };
}

export async function prepareProviderShadowPilot(repositoryRoot, contractPath) {
  const loaded = await loadProviderShadowContract(repositoryRoot, contractPath);
  const authority = JSON.parse(
    await readFile(resolve(repositoryRoot, ".lervo/state/workstreams/current.json"), "utf8"),
  );
  if (
    authority.workstreamId !== "wks_715d83744a212f47e5c6555c" ||
    authority.revision !== 149 ||
    authority.title !== "Exact provider-shadow v1 execution authorized" ||
    authority.pendingDecisions.length !== 0 ||
    !authority.notes.some((note) =>
      note.includes("wdec_b328f45d0a7196ce as authorize_exact_shadow_v1"),
    )
  ) {
    throw new Error("provider_shadow_authority_missing");
  }
  const paths = providerShadowPaths(repositoryRoot, loaded.contract.pilotId);
  await mkdir(paths.pilotsRoot, { recursive: true, mode: 0o700 });
  const existing = await readdir(paths.pilotsRoot);
  if (existing.length >= loaded.contract.observation.maximumPilots) {
    throw new Error("The provider-shadow retention bound is already full.");
  }
  const phase = phaseAPaths(repositoryRoot, loaded.contract.sourcePopulation.phaseAPilotId);
  const reconstructed = await reconstructProviderShadowSchedule(repositoryRoot, loaded, phase);
  const maximumCandidateSources = Math.max(
    ...reconstructed.schedule.map((item) => item.candidateCount),
  );
  const maximumProviderVisibleSourceBytes = Math.max(
    ...reconstructed.schedule.map((item) => item.providerVisibleSourceBytes),
  );
  if (
    reconstructed.schedule.length !== loaded.contract.sourcePopulation.expectedShadowSampleCount ||
    maximumCandidateSources !== loaded.contract.candidateEnvelope.expectedMaximumCandidateSources ||
    maximumProviderVisibleSourceBytes !==
      loaded.contract.candidateEnvelope.expectedMaximumProviderVisibleSourceBytes ||
    maximumProviderVisibleSourceBytes >
      loaded.contract.candidateEnvelope.maximumProviderVisibleSourceBytesPerCall
  ) {
    throw new Error("provider_shadow_candidate_drift");
  }
  const manifest = {
    schemaVersion: 1,
    pilotId: loaded.contract.pilotId,
    projectId: reconstructed.phasePrepared.manifest.projectId,
    preparedAt: new Date().toISOString(),
    contractDigest: loaded.contractDigest,
    authority: {
      workstreamId: authority.workstreamId,
      revision: authority.revision,
      snapshotDigest: valueDigest(authority),
      decisionId: "wdec_b328f45d0a7196ce",
      choiceId: "authorize_exact_shadow_v1",
    },
    providerCalls: 0,
    provider: loaded.contract.provider.provider,
    model: loaded.contract.provider.model,
    sourcePhaseAManifestDigest: reconstructed.phasePrepared.manifestDigest,
    sourceSnapshotDigest: valueDigest(reconstructed.phasePrepared.manifest.sourceSnapshot),
    sourceSuiteDigest: loaded.contract.groundTruth.sourceSuiteDigest,
    sourceCorpusDigest: reconstructed.phasePrepared.manifest.corpusDigest,
    phaseRepositoryStatusDigest: repositoryStatusDigest(phase.repository),
    maximumCandidateSources,
    maximumProviderVisibleSourceBytes,
    scheduleDigest: valueDigest(reconstructed.schedule),
    schedule: reconstructed.schedule,
  };
  const wrapper = { manifest, manifestDigest: valueDigest(manifest) };
  await ownerJson(paths.prepared, wrapper);
  return { loaded, paths, phase, ...wrapper };
}

export async function loadPreparedProviderShadowPilot(repositoryRoot, contractPath) {
  const loaded = await loadProviderShadowContract(repositoryRoot, contractPath);
  const paths = providerShadowPaths(repositoryRoot, loaded.contract.pilotId);
  const phase = phaseAPaths(repositoryRoot, loaded.contract.sourcePopulation.phaseAPilotId);
  const wrapper = JSON.parse(await readFile(paths.prepared, "utf8"));
  if (
    valueDigest(wrapper.manifest) !== wrapper.manifestDigest ||
    wrapper.manifest.contractDigest !== loaded.contractDigest ||
    wrapper.manifest.providerCalls !== 0
  ) {
    throw new Error("provider_shadow_manifest_drift");
  }
  const reconstructed = await reconstructProviderShadowSchedule(repositoryRoot, loaded, phase);
  if (
    valueDigest(reconstructed.schedule) !== wrapper.manifest.scheduleDigest ||
    stableJson(reconstructed.schedule) !== stableJson(wrapper.manifest.schedule)
  ) {
    throw new Error("provider_shadow_candidate_drift");
  }
  return { loaded, paths, phase, ...wrapper, reconstructed };
}

export { ownerJson };
