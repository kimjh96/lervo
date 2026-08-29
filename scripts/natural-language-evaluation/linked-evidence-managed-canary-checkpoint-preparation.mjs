import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  createManagedCanaryCheckpointSchedule,
  loadManagedCanaryCheckpointContract,
} from "./linked-evidence-managed-canary-checkpoint-contract.mjs";
import {
  loadManagedCanaryCheckpointSourceEvidence,
  prepareManagedCanarySelectionEvidence,
} from "./linked-evidence-managed-canary-checkpoint-evidence.mjs";
import { observeRepositorySnapshot } from "./delegated-retrieval-workspace.mjs";
import { repositoryStatusDigest } from "./linked-evidence-provider-shadow-pilot-preparation.mjs";
import { valueDigest } from "./linked-evidence-shadow-phase-a-pilot-contract.mjs";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function managedCanaryCheckpointPaths(repositoryRoot, contract) {
  const pilotsRoot = resolve(repositoryRoot, contract.retention.root);
  const root = resolve(pilotsRoot, contract.checkpointId);
  return {
    pilotsRoot,
    root,
    prepared: resolve(root, "controller/prepared.json"),
    sourceRepository: resolve(
      repositoryRoot,
      ".lervo/state/search/linked-evidence-shadow-pilots",
      contract.sourcePopulation.phaseAPilotId,
      "repository",
    ),
    sourcePrepared: resolve(
      repositoryRoot,
      ".lervo/state/search/linked-evidence-shadow-pilots",
      contract.sourcePopulation.phaseAPilotId,
      "controller/prepared.json",
    ),
    sourceReview: resolve(
      repositoryRoot,
      ".lervo/state/search/linked-evidence-shadow-pilots",
      contract.sourcePopulation.phaseAPilotId,
      "controller/review.json",
    ),
    v18Prepared: resolve(
      repositoryRoot,
      ".lervo/state/search/linked-evidence-provider-shadow-pilots",
      contract.sourcePopulation.sourceProviderShadowPilotId,
      "controller/prepared.json",
    ),
    v18Review: resolve(
      repositoryRoot,
      ".lervo/state/search/linked-evidence-provider-shadow-pilots",
      contract.sourcePopulation.sourceProviderShadowPilotId,
      "controller/review.json",
    ),
    v18Observations: resolve(
      repositoryRoot,
      ".lervo/state/search/linked-evidence-provider-shadow-pilots",
      contract.sourcePopulation.sourceProviderShadowPilotId,
      "observations",
    ),
  };
}

async function writeOwnerJsonImmutable(path, value) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  try {
    await writeFile(path, content, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if (error?.code !== "EEXIST" || (await readFile(path, "utf8")) !== content) throw error;
  }
  await chmod(path, 0o600);
  if (process.platform !== "win32" && ((await stat(path)).mode & 0o777) !== 0o600) {
    throw new Error("The managed canary prepared manifest is not owner-only.");
  }
}

async function prepareRunCoordinates(input) {
  const [
    { loadProjectManifest, loadDocumentRegistry },
    searchLocal,
    context,
    cliSearch,
    cliCanary,
  ] = await Promise.all([
    import("../../packages/project/dist/index.js"),
    import("../../packages/search-local/dist/index.js"),
    import("../../packages/context/dist/index.js"),
    import("../../apps/cli/dist/managed-search-context.js"),
    import("../../apps/cli/dist/managed-linked-evidence-canary-projection.js"),
  ]);
  const project = await loadProjectManifest(input.paths.sourceRepository);
  const documentRegistry = await loadDocumentRegistry(input.paths.sourceRepository);
  const corpus = await searchLocal.loadRegisteredDocumentCorpus(input.paths.sourceRepository);
  const pathByDocumentId = new Map(corpus.map((item) => [item.sourceId, item.path]));
  if (
    project.projectId !== input.source.phase.manifest.projectId ||
    valueDigest(
      corpus.map(({ sourceId, path, contentHash }) => ({
        documentId: sourceId,
        path,
        contentHash,
      })),
    ) !== input.contract.sourcePopulation.sourceCorpusDigest
  ) {
    throw new Error("managed_canary_registered_corpus_drift");
  }
  const sourceSchedule = createManagedCanaryCheckpointSchedule(
    input.contract,
    input.source.v18.manifest.schedule,
  );
  const runs = [];
  for (const item of sourceSchedule) {
    const sourceItem = input.source.v18.manifest.schedule.find(
      (candidate) =>
        candidate.sourceSampleId === item.sourceSampleId && candidate.provider === item.provider,
    );
    const expectedPath = pathByDocumentId.get(item.expectedDocumentIds[0]);
    if (sourceItem === undefined || expectedPath === undefined) {
      throw new Error("managed_canary_task_population_drift");
    }
    const search = await cliSearch.prepareManagedSearchContext({
      repositoryRoot: input.paths.sourceRepository,
      projectId: project.projectId,
      query: sourceItem.query,
      fallbackQuery: expectedPath,
      observedAt: new Date(item.observedAt),
      nonce: item.searchNonce,
      documentRegistry,
      expectedPaths: [expectedPath],
    });
    const projection = await cliCanary.prepareManagedLinkedEvidenceProjection({
      repositoryRoot: input.paths.sourceRepository,
      operationalBatch: search.recommendationBatch,
      recommendationBatches: search.recommendationBatches,
      graphRecommendations: search.graphRecommendations,
    });
    const schema = context.managedLinkedEvidenceSelectionSchema(projection.candidates);
    const selectionEvidence = prepareManagedCanarySelectionEvidence({
      contract: input.contract,
      source: input.source,
      scheduleItem: item,
      sourceItem,
      projection,
    });
    if (
      projection.policy.id !== input.contract.predecessor.policyId ||
      projection.policy.enabledByDefault !== false ||
      projection.policy.maximumCandidates !== input.contract.selection.maximumCandidates ||
      projection.policy.maximumProviderVisibleSourceBytes !==
        input.contract.selection.maximumProviderVisibleSourceBytes ||
      projection.providerVisibleSourceBytes >
        input.contract.selection.maximumProviderVisibleSourceBytes
    ) {
      throw new Error("managed_canary_projection_bound_exceeded");
    }
    runs.push({
      ...item,
      projectId: project.projectId,
      queryDigest: sha256(sourceItem.query),
      expectedPathDigest: sha256(expectedPath),
      recommendationBatchId: search.recommendationBatch.batchId,
      recommendationBatchDigest: valueDigest(search.recommendationBatch),
      sourceSnapshotId: projection.sourceSnapshotId,
      projectionDigest: projection.projectionDigest,
      ...(input.contract.selection.maximumSelectionCallsPerRun === 0
        ? {}
        : { selectionSchemaDigest: valueDigest(schema) }),
      candidateCount: projection.candidates.length,
      candidateDigest: valueDigest(
        projection.candidates.map(({ documentId, contentHash, byteCount, token }) => ({
          documentId,
          contentHash,
          byteCount,
          tokenDigest: sha256(token),
        })),
      ),
      providerVisibleSourceBytes: projection.providerVisibleSourceBytes,
      ...(selectionEvidence === null
        ? {}
        : {
            selectionProviderVisibleSourceBytes: 0,
            selectionEvidence,
          }),
      requestedAuthority: {
        maximumSelectionCalls: input.contract.selection.maximumSelectionCallsPerRun,
        managedContextEffects: true,
      },
      grantedAuthority: {
        enabled: false,
        providerCalls: false,
        managedContextEffects: false,
      },
    });
  }
  return { projectId: project.projectId, runs };
}

export async function prepareManagedCanaryCheckpoint(repositoryRoot, contractPath) {
  const loaded = await loadManagedCanaryCheckpointContract(repositoryRoot, contractPath);
  const paths = managedCanaryCheckpointPaths(repositoryRoot, loaded.contract);
  await mkdir(paths.pilotsRoot, { recursive: true, mode: 0o700 });
  await chmod(paths.pilotsRoot, 0o700);
  const retained = (await readdir(paths.pilotsRoot, { withFileTypes: true })).filter((item) =>
    item.isDirectory(),
  );
  if (
    retained.length > loaded.contract.retention.maximumPilots ||
    (retained.length === loaded.contract.retention.maximumPilots &&
      !retained.some((item) => item.name === loaded.contract.checkpointId))
  ) {
    throw new Error("The managed canary checkpoint retention bound is full.");
  }
  const workstream = JSON.parse(
    await readFile(resolve(repositoryRoot, ".lervo/state/workstreams/current.json"), "utf8"),
  );
  if (
    workstream.workstreamId !== loaded.contract.preparation.workstreamId ||
    workstream.revision !== loaded.contract.preparation.workstreamRevision ||
    workstream.title !== loaded.contract.preparation.workstreamTitle ||
    workstream.pendingDecisions.length !== 0 ||
    workstream.pendingApprovals.length !== 0
  ) {
    throw new Error("managed_canary_preparation_authority_missing");
  }
  const source = await loadManagedCanaryCheckpointSourceEvidence(paths, loaded.contract);
  const prepared = await prepareRunCoordinates({ contract: loaded.contract, paths, source });
  const sourceRevision = observeRepositorySnapshot(repositoryRoot);
  const builtCliDigest = sha256(await readFile(resolve(repositoryRoot, "apps/cli/dist/bin.js")));
  const providers = Object.fromEntries(
    loaded.contract.providers.arms.map((arm) => [
      arm.provider,
      prepared.runs.filter((item) => item.provider === arm.provider).length,
    ]),
  );
  if (
    prepared.runs.length !== loaded.contract.providers.maximumTaskRuns ||
    providers.codex !== 8 ||
    providers.claude !== 8 ||
    new Set(prepared.runs.map((item) => item.sourceSampleId)).size !==
      loaded.contract.sourcePopulation.sourceTaskCount
  ) {
    throw new Error("managed_canary_prepared_schedule_invalid");
  }
  const manifest = {
    schemaVersion: 1,
    checkpointId: loaded.contract.checkpointId,
    status: "prepared_for_review",
    preparedAt: loaded.contract.preparation.manifestPreparedAt,
    contractDigest: loaded.contractDigest,
    projectId: prepared.projectId,
    sourcePhaseManifestDigest: source.phase.manifestDigest,
    sourceProviderShadowManifestDigest: source.v18.manifestDigest,
    ...(source.v18Review === null
      ? {}
      : {
          sourceProviderShadowReviewFileDigest:
            loaded.contract.sourcePopulation.sourceProviderShadowReviewFileDigest,
          frozenSelectionEvidenceDigest: valueDigest(
            prepared.runs.map((item) => item.selectionEvidence),
          ),
        }),
    sourceCorpusDigest: source.phase.manifest.corpusDigest,
    sourceRepositoryStatusDigest: repositoryStatusDigest(paths.sourceRepository),
    sourceRevision,
    builtCliDigest,
    workstream: {
      workstreamId: workstream.workstreamId,
      revision: workstream.revision,
      snapshotDigest: valueDigest(workstream),
    },
    rollbackPredecessor: loaded.contract.predecessor,
    taskRunCount: prepared.runs.length,
    selectionCallCeiling: loaded.contract.providers.maximumSelectionCalls,
    taskCallCeiling: loaded.contract.providers.maximumTaskCalls,
    providerCallCeiling: loaded.contract.providers.maximumProviderCalls,
    providerCalls: 0,
    executionAuthorized: false,
    managedContextEffectsAuthorized: false,
    scheduleDigest: valueDigest(prepared.runs),
    runs: prepared.runs,
  };
  const wrapper = { manifest, manifestDigest: valueDigest(manifest) };
  await writeOwnerJsonImmutable(paths.prepared, wrapper);
  return { loaded, paths, ...wrapper };
}

export async function loadPreparedManagedCanaryCheckpoint(repositoryRoot, contractPath) {
  const loaded = await loadManagedCanaryCheckpointContract(repositoryRoot, contractPath);
  const paths = managedCanaryCheckpointPaths(repositoryRoot, loaded.contract);
  const wrapper = JSON.parse(await readFile(paths.prepared, "utf8"));
  if (
    valueDigest(wrapper.manifest) !== wrapper.manifestDigest ||
    wrapper.manifest.contractDigest !== loaded.contractDigest ||
    wrapper.manifest.providerCalls !== 0 ||
    wrapper.manifest.executionAuthorized !== false ||
    wrapper.manifest.managedContextEffectsAuthorized !== false
  ) {
    throw new Error("managed_canary_prepared_manifest_drift");
  }
  return { loaded, paths, ...wrapper };
}
