import {
  recordContextQualityPreparation,
  beginContextQualityObservationScope,
  beginContextQualityStorageOpening,
} from "./context-quality-recording.js";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";
import {
  contextQualityTaskDigest,
  normalizeContextQualityIngress,
  projectTaskQuery,
  ContextQualityError,
  readRepositoryFile,
  taskQueryProjectorBuild,
} from "@lervo/context";
import { loadProjectManifest } from "@lervo/project";
import { sha256 } from "@lervo/repository-knowledge";
import { canonicalHash } from "@lervo/search";
import type { ContextQualityBindings, ContextQualityIngress } from "@lervo/schemas";
import {
  prepareContextQuality,
  type ContextQualityPreparationResult,
} from "./context-quality-preparation.js";
import { contextPreparationHost } from "./context-preparation-host.js";
import { readRepositoryQualitySnapshot } from "./repository-quality-snapshot.js";
import {
  prepareRepositoryQualityEvidence,
  type QualityCandidate,
  type QualityPassage,
} from "./repository-quality-evidence.js";

export const repositoryQualityBuild = canonicalHash({
  id: "repository_quality_local_read",
  version: 2,
});
export interface RepositoryQualityInput {
  repositoryRoot: string;
  task: ContextQualityIngress["task"];
  origin: ContextQualityIngress["origin"]["kind"];
  instructionMaximumBytes: number;
  evidenceMaximumBytes: number;
  retrieval: "completed" | "not_run" | "unavailable";
  candidates: readonly QualityCandidate[];
  sourceSnapshotId: string;
  retrievalBuildId: string;
  projectedQueries?: readonly string[];
  projectorBuildId?: string;
  retrievalPlanId?: string;
  signal?: AbortSignal;
  deadlineMs?: number;
  recordObservation?: boolean;
  recordingCoordinates?: { runId: string; sessionId: string };
}

/** All product consumers enter the same bounded preparation; transport claims never grant authority. */
async function prepareWithoutRecording(input: RepositoryQualityInput) {
  const requestId = `qreq_${randomUUID().replaceAll("-", "")}`;
  const failure = (error: unknown) => ({
    result: {
      requestId,
      status:
        error instanceof ContextQualityError && error.code === "context_cancelled"
          ? "cancelled"
          : "unavailable",
      plan: null,
      reasonCodes: [
        error instanceof ContextQualityError ? error.code : "context_binding_unavailable",
      ],
      missingBindings: [],
    } as ContextQualityPreparationResult,
    passages: [] as QualityPassage[],
    instructions: null,
    observationBindings: null,
  });
  try {
    input = {
      ...input,
      task: structuredClone(input.task),
      candidates: structuredClone(input.candidates),
      ...(input.projectedQueries === undefined
        ? {}
        : { projectedQueries: [...input.projectedQueries] }),
    };
    if (!input.retrievalBuildId) throw new ContextQualityError("context_binding_unavailable");
    const root = await realpath(input.repositoryRoot);
    const manifest = await loadProjectManifest(root);
    const ingress = normalizeContextQualityIngress({
      schemaVersion: 1,
      requestId,
      projectId: manifest.projectId,
      taskRevision: 1,
      task: input.task,
      origin: {
        kind: input.origin,
        adapterBuildId: repositoryQualityBuild,
        correlationId: requestId,
      },
    });
    if (
      input.candidates.length > 50 ||
      new Set(input.candidates.map((candidate) => candidate.path)).size !==
        input.candidates.length ||
      !Number.isInteger(input.instructionMaximumBytes) ||
      input.instructionMaximumBytes < 0 ||
      !Number.isInteger(input.evidenceMaximumBytes) ||
      input.evidenceMaximumBytes < 0 ||
      input.instructionMaximumBytes + input.evidenceMaximumBytes > 1048576
    )
      throw new ContextQualityError("context_contract_invalid");
    const queries =
      input.projectedQueries ??
      (input.retrieval === "not_run" ? [] : [projectTaskQuery(ingress.task).query]);
    const deadlineMs = input.deadlineMs ?? 3000;
    // No completed task cache: evict at the final reader. In-flight sharing includes root, task, plan and capacities.
    const shared = await contextPreparationHost.run({
      key: canonicalHash({
        root,
        task: ingress.task,
        snapshot: input.sourceSnapshotId,
        candidates: input.candidates,
        queries,
        retrieval: input.retrieval,
        build: input.retrievalBuildId,
        projector: input.projectorBuildId ?? null,
        plan: input.retrievalPlanId ?? null,
        deadlineMs,
        instructionBytes: input.instructionMaximumBytes,
        evidenceBytes: input.evidenceMaximumBytes,
      }),
      reservedBytes: 16 * 1024 * 1024,
      deadlineMs,
      maximumProviderCalls: 0,
      signal: input.signal ?? new AbortController().signal,
      work: async ({ signal }) => {
        let activePort: Promise<unknown> | undefined;
        const observePort = <T>(promise: Promise<T>): Promise<T> => {
          activePort = promise;
          return promise;
        };
        let snapshot: Awaited<ReturnType<typeof readRepositoryQualitySnapshot>>;
        let prepared: Awaited<ReturnType<typeof prepareRepositoryQualityEvidence>> | undefined;
        const bindings = (
          current: Awaited<ReturnType<typeof readRepositoryQualitySnapshot>>,
        ): ContextQualityBindings => ({
          projectId: ingress.projectId,
          taskRevision: ingress.taskRevision,
          taskDigest: contextQualityTaskDigest(ingress),
          scopeDigest: current.scopeDigest,
          policySetDigest: current.policySetDigest,
          sourceSnapshotId: input.sourceSnapshotId,
          retrievalPlanId: input.retrievalPlanId ?? "local_observed_selection_v1",
          profileId: "local_bounded_preparation_v1",
          profile: {
            maximumBytes: Math.max(1, input.instructionMaximumBytes + input.evidenceMaximumBytes),
            maximumTokens: 1048576,
            deadlineMs,
            maximumConcurrent: 2,
            maximumPending: 32,
            maximumRetainedBytes: 16 * 1024 * 1024,
            maximumProviderCalls: 0,
          },
          builds: {
            core: repositoryQualityBuild,
            retrieval: canonicalHash(input.retrievalBuildId),
            projector: input.projectorBuildId
              ? canonicalHash(input.projectorBuildId)
              : taskQueryProjectorBuild,
          },
          projectedQueries: [...queries],
          executionCapabilities: {
            controlledProviderInput: false,
            exactDeliveryAcknowledgement: false,
            observedArtifactAccess: false,
            controlledConsequentialEffects: false,
          },
        });
        const result = await prepareContextQuality({
          ingress,
          deadlineMs,
          signal,
          now: () => performance.now(),
          ports: {
            resolveBindings: async () => {
              snapshot = await observePort(readRepositoryQualitySnapshot(root, ingress));
              return { status: "resolved", bindings: bindings(snapshot) };
            },
            prepare: async (request) => {
              prepared = await observePort(
                prepareRepositoryQualityEvidence({
                  root,
                  request,
                  instructions: snapshot.sources,
                  candidates: input.candidates,
                  instructionMaximumBytes: input.instructionMaximumBytes,
                  evidenceMaximumBytes: input.evidenceMaximumBytes,
                  retrieval: input.retrieval,
                }),
              );
              return prepared;
            },
            revalidate: () =>
              observePort(
                (async () => {
                  for (const candidate of input.candidates) {
                    if (
                      sha256(await readRepositoryFile(root, candidate.path, 131072)) !==
                      candidate.contentHash
                    )
                      throw new ContextQualityError("context_binding_stale");
                  }
                  return bindings(await readRepositoryQualitySnapshot(root, ingress));
                })(),
              ),
          },
        });
        // Waiters detach immediately in the host; the reservation outlives any non-cooperative I/O.
        if (activePort) await Promise.allSettled([activePort]);
        return {
          result,
          passages: result.plan ? (prepared?.passages ?? []) : [],
          instructions: result.plan ? (prepared?.instructions ?? null) : null,
          observationBindings: result.plan
            ? {
                projectId: ingress.projectId,
                taskRevision: ingress.taskRevision,
                sourceSnapshotId: input.sourceSnapshotId,
                scopeDigest: snapshot!.scopeDigest,
                policySetDigest: snapshot!.policySetDigest,
                profileId: "local_bounded_preparation_v1",
              }
            : null,
        };
      },
    });
    // Attempt identity is per waiter; origin/attempt never changes the semantic plan digest.
    shared.result.requestId = requestId;
    if (shared.result.plan) shared.result.plan.requestId = requestId;
    return shared;
  } catch (error) {
    return failure(error);
  }
}

async function beginQualityObservation(input: RepositoryQualityInput, scoped = false) {
  const { repositoryRoot, origin, recordObservation } = input;
  const coordinates = input.recordingCoordinates ? { ...input.recordingCoordinates } : undefined;
  const opening =
    scoped && recordObservation ? beginContextQualityStorageOpening(repositoryRoot) : null;
  let prepared: Awaited<ReturnType<typeof prepareWithoutRecording>>;
  let opened: Awaited<ReturnType<typeof beginContextQualityStorageOpening>> | null;
  try {
    prepared = await prepareWithoutRecording(input);
  } finally {
    opened = opening ? await opening : null;
  }
  const seal =
    scoped && recordObservation
      ? beginContextQualityObservationScope(
          repositoryRoot,
          prepared.result.requestId,
          opened?.status === "available" && opened.reportWriting,
        )
      : undefined;
  const recording =
    opened && opened.status !== "available"
      ? Promise.resolve(opened)
      : recordObservation
        ? recordContextQualityPreparation({
            repositoryRoot,
            result: prepared.result,
            bindings: prepared.observationBindings,
            originKind: origin,
            adapterBuildId: repositoryQualityBuild,
            ...(coordinates ? { coordinates } : {}),
          })
        : Promise.resolve(null);
  // The observation owner drains this promise even when its read continuation fails.
  void recording.catch(() => undefined);
  return { prepared, recording, seal };
}

export async function prepareRepositoryQualityContext(input: RepositoryQualityInput) {
  const { prepared, recording } = await beginQualityObservation(input);
  return { ...prepared, recording: await recording };
}

/** Drains observation and recording together; callers keep consequential effects after this boundary. */
export async function withRepositoryQualityObservation<T>(
  input: RepositoryQualityInput,
  observe: (prepared: Awaited<ReturnType<typeof prepareWithoutRecording>>) => Promise<T>,
) {
  const { prepared, recording, seal } = await beginQualityObservation(input, true);
  const [readResult, recordingResult] = await Promise.allSettled([
    Promise.resolve()
      .then(() => observe(structuredClone(prepared)))
      .finally(() => seal?.()),
    recording,
  ]);
  if (readResult.status === "rejected") {
    if (recordingResult.status === "rejected")
      throw new AggregateError(
        [readResult.reason, recordingResult.reason],
        "Context observation and recording both failed.",
      );
    throw readResult.reason;
  }
  if (recordingResult.status === "rejected") throw recordingResult.reason;
  return {
    preparation: { ...prepared, recording: recordingResult.value },
    value: readResult.value,
  };
}
