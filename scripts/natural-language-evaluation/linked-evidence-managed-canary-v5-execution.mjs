import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { valueDigest } from "./linked-evidence-shadow-phase-a-pilot-contract.mjs";
import {
  loadPreparedManagedCanaryCheckpoint,
  managedCanaryCheckpointPaths,
} from "./linked-evidence-managed-canary-checkpoint-preparation.mjs";
import { managedCanaryV5CheckpointContractPath } from "./linked-evidence-managed-canary-checkpoint-contract.mjs";
import { observeRepositorySnapshot } from "./delegated-retrieval-workspace.mjs";
import { executeManagedCanaryNativeTask } from "./linked-evidence-managed-canary-native-task.mjs";

const authorityBasis = "explicit_user_autonomous_completion_and_codex_claude_measurement";

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
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
    throw new Error("managed_canary_v5_evidence_not_owner_only");
  }
}

function executionPaths(paths) {
  return {
    authorization: resolve(paths.root, "controller/authorization.json"),
    attempts: resolve(paths.root, "attempts"),
    observations: resolve(paths.root, "observations"),
    review: resolve(paths.root, "controller/review.json"),
  };
}

export function createExactManagedCanaryV5Authorization(input) {
  assert(
    /^sha256:[a-f0-9]{64}$/u.test(input.manifestDigest),
    "managed_canary_v5_unreviewed_manifest",
  );
  return {
    schemaVersion: 1,
    authorizationId: `lcanauth_${input.manifestDigest.slice(-24)}`,
    checkpointId: input.checkpointId,
    preparedManifestDigest: input.manifestDigest,
    authorityBasis,
    authorizedAt: input.authorizedAt,
    providers: { codex: 8, claude: 8 },
    maximumSelectionCalls: 0,
    maximumTaskCalls: 16,
    maximumProviderCalls: 16,
    userApiKeysRequired: false,
    nativeSignedInSessionsRequired: true,
    retriesAuthorized: false,
    repairsAuthorized: false,
    replacementsAuthorized: false,
    writesAuthorized: false,
    productionActivationAuthorized: false,
  };
}

async function loadExecutionContext(repositoryRoot, contractPath) {
  const prepared = await loadPreparedManagedCanaryCheckpoint(repositoryRoot, contractPath);
  const currentRevision = observeRepositorySnapshot(repositoryRoot);
  const currentBuiltCliDigest = sha256(
    await readFile(resolve(repositoryRoot, "apps/cli/dist/bin.js")),
  );
  assert(
    valueDigest(currentRevision) === valueDigest(prepared.manifest.sourceRevision) &&
      currentBuiltCliDigest === prepared.manifest.builtCliDigest,
    "managed_canary_v5_source_or_build_drift",
  );
  const paths = managedCanaryCheckpointPaths(repositoryRoot, prepared.loaded.contract);
  const execution = executionPaths(paths);
  const authorization = JSON.parse(await readFile(execution.authorization, "utf8"));
  assert(
    authorization.preparedManifestDigest === prepared.manifestDigest &&
      authorization.authorityBasis === authorityBasis &&
      authorization.maximumSelectionCalls === 0 &&
      authorization.maximumTaskCalls === 16 &&
      authorization.maximumProviderCalls === 16 &&
      authorization.userApiKeysRequired === false &&
      authorization.nativeSignedInSessionsRequired === true &&
      authorization.retriesAuthorized === false &&
      authorization.repairsAuthorized === false &&
      authorization.replacementsAuthorized === false,
    "managed_canary_v5_execution_authority_invalid",
  );
  return { prepared, paths, execution, authorization };
}

export async function authorizeManagedCanaryV5(
  repositoryRoot,
  manifestDigest,
  contractPath = managedCanaryV5CheckpointContractPath,
) {
  const prepared = await loadPreparedManagedCanaryCheckpoint(repositoryRoot, contractPath);
  assert(
    prepared.manifestDigest === manifestDigest,
    "managed_canary_v5_authorization_digest_mismatch",
  );
  const paths = managedCanaryCheckpointPaths(repositoryRoot, prepared.loaded.contract);
  const authorization = createExactManagedCanaryV5Authorization({
    checkpointId: prepared.manifest.checkpointId,
    manifestDigest,
    authorizedAt: new Date().toISOString(),
  });
  await writeOwnerJsonImmutable(executionPaths(paths).authorization, authorization);
  return authorization;
}

async function existingOrdinals(root) {
  const { readdir } = await import("node:fs/promises");
  try {
    return (await readdir(root))
      .filter((item) => /^\d{2}-(?:codex|claude)\.json$/u.test(item))
      .map((item) => Number.parseInt(item.slice(0, 2), 10))
      .sort((left, right) => left - right);
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function executeNextManagedCanaryV5Run(
  repositoryRoot,
  contractPath = managedCanaryV5CheckpointContractPath,
) {
  const context = await loadExecutionContext(repositoryRoot, contractPath);
  const completed = await existingOrdinals(context.execution.observations);
  if (completed.length >= context.prepared.manifest.runs.length) {
    return { status: "complete", completedRuns: completed.length };
  }
  const run = context.prepared.manifest.runs[completed.length];
  assert(run.ordinal === completed.length + 1, "managed_canary_v5_observation_gap");
  const stem = `${String(run.ordinal).padStart(2, "0")}-${run.provider}.json`;
  const attemptPath = resolve(context.execution.attempts, stem);
  const observationPath = resolve(context.execution.observations, stem);
  const attempt = {
    schemaVersion: 1,
    checkpointId: context.prepared.manifest.checkpointId,
    preparedManifestDigest: context.prepared.manifestDigest,
    ordinal: run.ordinal,
    runId: run.runId,
    provider: run.provider,
    model: run.model,
    status: "started",
    startedAt: new Date().toISOString(),
  };
  await writeOwnerJsonImmutable(attemptPath, attempt);

  const sourcePrepared = JSON.parse(await readFile(context.paths.v18Prepared, "utf8"));
  const sourceItem = sourcePrepared.manifest.schedule.find(
    (item) => item.sourceSampleId === run.sourceSampleId && item.provider === run.provider,
  );
  assert(sourceItem !== undefined, "managed_canary_v5_source_task_missing");
  try {
    const result = await executeManagedCanaryNativeTask({
      checkpointId: context.prepared.manifest.checkpointId,
      sourceRepository: context.paths.sourceRepository,
      run,
      sourceItem,
      roleId: context.prepared.loaded.contract.task.roleId,
    });
    const observation = {
      schemaVersion: 1,
      recordKind: "linked_evidence_managed_canary_observation.v2",
      checkpointId: context.prepared.manifest.checkpointId,
      preparedManifestDigest: context.prepared.manifestDigest,
      ordinal: run.ordinal,
      runId: run.runId,
      provider: run.provider,
      model: run.model,
      status: "completed",
      terminalStatus: "completed",
      failureCode: null,
      taskProviderCalls: result.providerStarts,
      selectionProviderCalls: 0,
      adapterCreations: result.adapterCreations,
      durationMs: result.durationMs,
      usage: result.usage,
      candidateCount: run.candidateCount,
      selectedCount: run.selectionEvidence.projectedSelectionCount,
      expected: result.expected,
      referenced: result.references,
      expectedReferencedCount: result.expectedReferencedCount,
      sourceRecall: result.sourceRecall,
      referencePrecision: result.referencePrecision,
      verificationStatus: result.verificationStatus,
      writingPublicationStatus: result.writingPublicationStatus,
      repositoryStatusDigestBefore: result.repositoryStatusDigestBefore,
      repositoryStatusDigestAfter: result.repositoryStatusDigestAfter,
      resultArtifactDigest: result.resultArtifactDigest,
      observedAt: new Date().toISOString(),
    };
    await writeOwnerJsonImmutable(observationPath, observation);
    return observation;
  } catch (error) {
    const failure = {
      schemaVersion: 1,
      recordKind: "linked_evidence_managed_canary_observation.v2",
      checkpointId: context.prepared.manifest.checkpointId,
      preparedManifestDigest: context.prepared.manifestDigest,
      ordinal: run.ordinal,
      runId: run.runId,
      provider: run.provider,
      model: run.model,
      status: "failed",
      terminalStatus: "failed",
      failureCode: "task_execution_failed",
      taskProviderCalls: error.canaryEvidence?.providerStarts ?? 0,
      selectionProviderCalls: 0,
      adapterCreations: error.canaryEvidence?.adapterCreations ?? 0,
      durationMs: error.canaryEvidence?.durationMs ?? 0,
      usage: error.canaryEvidence?.usage ?? null,
      errorDigest: sha256(error instanceof Error ? `${error.name}:${error.message}` : "unknown"),
      observedAt: new Date().toISOString(),
    };
    await writeOwnerJsonImmutable(observationPath, failure);
    throw error;
  }
}

export async function managedCanaryV5ExecutionStatus(
  repositoryRoot,
  contractPath = managedCanaryV5CheckpointContractPath,
) {
  const context = await loadExecutionContext(repositoryRoot, contractPath);
  const ordinals = await existingOrdinals(context.execution.observations);
  const observations = [];
  for (const ordinal of ordinals) {
    const run = context.prepared.manifest.runs[ordinal - 1];
    observations.push(
      JSON.parse(
        await readFile(
          resolve(
            context.execution.observations,
            `${String(ordinal).padStart(2, "0")}-${run.provider}.json`,
          ),
          "utf8",
        ),
      ),
    );
  }
  return {
    status: observations.some((item) => item.status === "failed")
      ? "failed"
      : observations.length === context.prepared.manifest.runs.length
        ? "complete"
        : "authorized",
    preparedManifestDigest: context.prepared.manifestDigest,
    completedRuns: observations.filter((item) => item.status === "completed").length,
    failedRuns: observations.filter((item) => item.status === "failed").length,
    providerCalls: observations.reduce((total, item) => total + item.taskProviderCalls, 0),
    selectionCalls: observations.reduce((total, item) => total + item.selectionProviderCalls, 0),
    observations,
    observationSetDigest: valueDigest(observations),
  };
}
