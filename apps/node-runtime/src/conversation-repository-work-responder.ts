import { pendingCanonicalizationCandidates } from "./conversation-canonicalization-assignment.js";
import { executionInstructions, fitDiscord } from "./conversation-repository-work-writing.js";
import { createHash } from "node:crypto";

import type { RepositoryWorkTurnExecutor } from "@lervo/adapter-contract";
import {
  readConversationControlMessage,
  createVerifiedConversationControlReply,
} from "@lervo/conversation-control";
import { realtimeConversationWritingContract } from "@lervo/core";
import { inspectEventWriterCoordinate } from "@lervo/project";
import type { ConversationResponder } from "@lervo/interaction";
import type { ArtifactStore } from "@lervo/storage-contract";

import { SQLiteConversationRepositoryWorkStore } from "./conversation-repository-work-store.js";
import { selectConversationRepositoryWorkRoute } from "./conversation-repository-work-routing.js";
import type {
  NodeRepositoryWorkExecutionProfile,
  NodeRepositoryWorkExecutionProfilePolicy,
} from "./config-types.js";
import {
  compareRepositoryWork,
  observeRepositoryWork,
  RepositoryWorkObservationLimitError,
} from "./repository-work-observation.js";
import { awaitRepositoryReplicaReadiness } from "./repository-replica-readiness.js";
import {
  captureConversationRepositoryWorkCompletionBaseline,
  verifyConversationRepositoryWorkCompletion,
} from "./conversation-repository-work-completion.js";
import { reconcileConversationRepositoryWorkCheckpoint } from "./conversation-repository-work-checkpoint.js";
import { recoverConversationRepositoryWorkCompletion } from "./conversation-repository-work-recovery.js";
import { prepareRepositoryWorkSourceManifest } from "./repository-work-source-manifest.js";
import { captureConversationRepositoryWorkPendingBaseline } from "./conversation-repository-work-completion.js";

const MAXIMUM_FINALIZATION_RESERVE_MS = 5 * 60_000;
const MINIMUM_FINALIZATION_RESERVE_MS = 2_000;

function finalizationStartsAt(timeoutMs: number, now = Date.now()): string {
  const reserve = Math.min(
    MAXIMUM_FINALIZATION_RESERVE_MS,
    Math.max(MINIMUM_FINALIZATION_RESERVE_MS, Math.floor(timeoutMs / 5)),
  );
  return new Date(now + Math.max(0, timeoutMs - reserve)).toISOString();
}

class ConversationRepositoryWorkStageError extends Error {
  constructor(
    readonly code:
      | "repository_observation_failed"
      | "repository_result_storage_failed"
      | "repository_work_in_progress",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ConversationRepositoryWorkStageError";
  }
}

function failureCode(error: unknown): string {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[a-z][a-z0-9_]{0,63}$/u.test(error.code)
    ? error.code
    : "repository_work_failed";
}

async function observe(repositoryRoot: string) {
  try {
    return await observeRepositoryWork(repositoryRoot);
  } catch (error) {
    if (error instanceof RepositoryWorkObservationLimitError) throw error;
    throw new ConversationRepositoryWorkStageError(
      "repository_observation_failed",
      "The repository work state could not be observed.",
      { cause: error },
    );
  }
}

async function readStoredResult(
  artifacts: ArtifactStore,
  reference: { contentHash: string; byteCount: number },
): Promise<string> {
  const uri = `lervo-cas://sha256/${reference.contentHash.slice("sha256:".length)}`;
  const bytes = new Uint8Array(await artifacts.get(uri));
  const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (bytes.byteLength !== reference.byteCount || contentHash !== reference.contentHash) {
    throw new Error("The durable conversation work result differs from its artifact.");
  }
  return new TextDecoder("utf8", { fatal: true }).decode(bytes);
}

export class ConversationRepositoryWorkResponder implements ConversationResponder {
  private readonly abortController = new AbortController();

  constructor(
    private readonly options: {
      repositoryRoot: string;
      artifactStore: ArtifactStore;
      store: SQLiteConversationRepositoryWorkStore;
      parentAgentId: string;
      workerSelection?: "configured_agent" | "conversation_delegate";
      executors: Partial<Record<"codex" | "claude", RepositoryWorkTurnExecutor>>;
      models?: Partial<Record<"codex" | "claude", string>>;
      reasoningEfforts?: Partial<
        Record<"codex" | "claude", "low" | "medium" | "high" | "xhigh" | "max">
      >;
      executionProfiles?: Record<
        NodeRepositoryWorkExecutionProfile,
        NodeRepositoryWorkExecutionProfilePolicy
      >;
      defaultProvider: "codex" | "claude";
      timeoutMs: number;
      repositoryReplica?: {
        required: true;
        maximumStalenessMs: number;
        waitTimeoutMs: number;
        pollIntervalMs: number;
      };
      completionLifecycle?: {
        capture: typeof captureConversationRepositoryWorkCompletionBaseline;
        reconcile?: typeof reconcileConversationRepositoryWorkCheckpoint;
        recover?: typeof recoverConversationRepositoryWorkCompletion;
        verify: typeof verifyConversationRepositoryWorkCompletion;
      };
      knowledgeMode?: "synchronous" | "pending_background";
      authorizedEffectRequesters?: readonly {
        participantId: string;
        roleId: string;
        conversationId: string;
      }[];
    },
  ) {}

  private externalEffectsAuthorized(
    event: Parameters<ConversationResponder["respond"]>[0]["event"],
  ): boolean {
    return (
      event.actor.kind === "human" ||
      this.options.authorizedEffectRequesters?.some(
        (requester) =>
          requester.participantId === event.actor.participantId &&
          requester.roleId === event.actor.roleId &&
          requester.conversationId === event.target.conversationId,
      ) === true
    );
  }

  /**
   * A v3 event writer settles knowledge through the ADR-0433 repository queue; an older writer
   * or an unreadable coordinate keeps the synchronous knowledge check. An explicit option wins.
   */
  private async knowledgeMode(): Promise<"synchronous" | "pending_background"> {
    if (this.options.knowledgeMode !== undefined) return this.options.knowledgeMode;
    try {
      const writer = await inspectEventWriterCoordinate(this.options.repositoryRoot);
      if (writer.coordinate.selectedEventSchemaVersion === 3) return "pending_background";
    } catch {
      // The stricter synchronous check needs no writer coordinate.
    }
    return "synchronous";
  }

  async respond(input: Parameters<ConversationResponder["respond"]>[0]) {
    const request = await readConversationControlMessage({
      artifactStore: this.options.artifactStore,
      event: input.event,
    });
    if (request.trim().length === 0 || request.length > 16_384 || request.includes("\0")) {
      throw new Error("The repository work request is empty or exceeds its text bound.");
    }
    const startedAt = new Date().toISOString();
    const delegate =
      this.options.workerSelection === "conversation_delegate"
        ? this.options.store.activeDelegate(
            input.event.target.conversationId,
            input.event.target.threadId,
          )
        : null;
    const workerId = delegate?.agentId ?? this.options.parentAgentId;
    const route = selectConversationRepositoryWorkRoute({
      replayProvider: this.options.store.providerForEvent(input.event.eventId),
      sessionProvider: this.options.store.sessionProvider(
        input.event.target.conversationId,
        input.event.target.threadId,
        workerId,
      ),
      boundProvider: delegate?.provider ?? null,
      defaultProvider: this.options.defaultProvider,
      executionProfile: input.context?.executionProfile ?? null,
      ...(this.options.executionProfiles === undefined
        ? {}
        : { executionProfiles: this.options.executionProfiles }),
      ...(this.options.models === undefined ? {} : { models: this.options.models }),
      ...(this.options.reasoningEfforts === undefined
        ? {}
        : { reasoningEfforts: this.options.reasoningEfforts }),
    });
    const provider = route.provider;
    const executor = this.options.executors[provider];
    if (executor === undefined) {
      throw new Error(`The ${provider} repository work executor is not configured.`);
    }
    const knowledgeMode = await this.knowledgeMode();
    const completionLifecycle = this.options.completionLifecycle ?? {
      capture:
        knowledgeMode === "pending_background"
          ? captureConversationRepositoryWorkPendingBaseline
          : captureConversationRepositoryWorkCompletionBaseline,
      reconcile: reconcileConversationRepositoryWorkCheckpoint,
      recover: recoverConversationRepositoryWorkCompletion,
      verify: verifyConversationRepositoryWorkCompletion,
    };
    let turn = this.options.store.begin({
      eventId: input.event.eventId,
      conversationId: input.event.target.conversationId,
      threadId: input.event.target.threadId,
      workerId,
      provider,
      requestContentHash: input.event.content.contentHash,
      startedAt,
    });
    if (turn.duplicate === "in_progress") {
      const recovered = await (
        completionLifecycle.recover ?? recoverConversationRepositoryWorkCompletion
      )({
        repositoryRoot: this.options.repositoryRoot,
        sourceConversationEventId: input.event.eventId,
        workerAgentId: workerId,
        provider,
        requestContentHash: input.event.content.contentHash,
      });
      if (recovered === null) {
        throw new ConversationRepositoryWorkStageError(
          "repository_work_in_progress",
          "The exact conversation work turn is still in progress.",
        );
      }
      this.options.store.reconcileCompletion({
        eventId: input.event.eventId,
        conversationId: input.event.target.conversationId,
        threadId: input.event.target.threadId,
        workerId,
        provider,
        providerSessionId: turn.providerSessionId,
        requestContentHash: input.event.content.contentHash,
        result: recovered.result,
        completedAt: recovered.completedAt,
      });
      turn = { ...turn, completed: recovered.result, duplicate: null };
    }
    if (turn.completed !== null) {
      const content = await readStoredResult(this.options.artifactStore, turn.completed);
      return createVerifiedConversationControlReply({
        artifactStore: this.options.artifactStore,
        writingContract: realtimeConversationWritingContract,
        content,
      });
    }
    try {
      if (this.options.repositoryReplica !== undefined) {
        await awaitRepositoryReplicaReadiness({
          repositoryRoot: this.options.repositoryRoot,
          maximumStalenessMs: this.options.repositoryReplica.maximumStalenessMs,
          waitTimeoutMs: this.options.repositoryReplica.waitTimeoutMs,
          pollIntervalMs: this.options.repositoryReplica.pollIntervalMs,
        });
      }
      const before = await observe(this.options.repositoryRoot);
      const completionBaseline = await completionLifecycle.capture(this.options.repositoryRoot);
      const externalEffectsAuthorized = this.externalEffectsAuthorized(input.event);
      const result = await executor.execute({
        repositoryRoot: this.options.repositoryRoot,
        instructions: executionInstructions({
          request,
          priorTurns: input.context?.priorTurns ?? [],
          durableResults: await Promise.all(
            this.options.store
              .recentCompletedResults({
                conversationId: input.event.target.conversationId,
                threadId: input.event.target.threadId,
                workerId,
                limit: 8,
              })
              .map((reference) => readStoredResult(this.options.artifactStore, reference)),
          ),
          worker: delegate,
          externalEffectsAuthorized,
          finalizationStartsAt: finalizationStartsAt(this.options.timeoutMs),
          canonicalizationCandidates: await pendingCanonicalizationCandidates(
            this.options.repositoryRoot,
          ),
        }),
        providerSessionId: turn.providerSessionId,
        ...(route.model === null ? {} : { model: route.model }),
        ...(route.reasoningEffort === null ? {} : { reasoningEffort: route.reasoningEffort }),
        ...(externalEffectsAuthorized ? { externalEffectsAuthorized: true } : {}),
        timeoutMs: this.options.timeoutMs,
        signal: this.abortController.signal,
      });
      let after = await observe(this.options.repositoryRoot);
      let repositoryChange = await compareRepositoryWork({
        repositoryRoot: this.options.repositoryRoot,
        before,
        after,
      });
      const content = fitDiscord(result.response);
      let stored;
      try {
        stored = await this.options.artifactStore.put(Buffer.from(content, "utf8"));
      } catch (error) {
        throw new ConversationRepositoryWorkStageError(
          "repository_result_storage_failed",
          "The repository work result could not be stored.",
          { cause: error },
        );
      }
      if (
        repositoryChange.changedPaths.length > 0 &&
        this.options.repositoryReplica !== undefined
      ) {
        await awaitRepositoryReplicaReadiness({
          repositoryRoot: this.options.repositoryRoot,
          maximumStalenessMs: this.options.repositoryReplica.maximumStalenessMs,
          waitTimeoutMs: this.options.repositoryReplica.waitTimeoutMs,
          pollIntervalMs: this.options.repositoryReplica.pollIntervalMs,
        });
        after = await observe(this.options.repositoryRoot);
        repositoryChange = await compareRepositoryWork({
          repositoryRoot: this.options.repositoryRoot,
          before,
          after,
        });
      }
      const checkpointDisposition =
        (await completionLifecycle.reconcile?.({
          repositoryRoot: this.options.repositoryRoot,
          provider,
          baseline: completionBaseline,
          repositoryChange,
          completedAt: result.completedAt,
        })) ?? "not_observed";
      const sourceManifest =
        knowledgeMode === "pending_background" && repositoryChange.changedPaths.length > 0
          ? prepareRepositoryWorkSourceManifest({ before, after, change: repositoryChange })
          : undefined;
      await completionLifecycle.verify({
        repositoryRoot: this.options.repositoryRoot,
        provider,
        baseline: completionBaseline,
        repositoryChange,
        sourceConversationEventId: input.event.eventId,
        workerAgentId: workerId,
        providerSessionId: result.providerSessionId,
        requestedModel: route.model,
        requestedReasoningEffort: route.reasoningEffort,
        executionProfile: route.executionProfile,
        allocationReason: route.allocationReason,
        requestContentHash: input.event.content.contentHash,
        result: { contentHash: stored.contentHash, byteCount: stored.byteCount, summary: content },
        completedAt: result.completedAt,
        replicaConfigured: this.options.repositoryReplica !== undefined,
        checkpointDisposition,
        knowledgeMode,
        ...(sourceManifest === undefined ? {} : { sourceManifest }),
      });
      this.options.store.complete({
        eventId: input.event.eventId,
        conversationId: input.event.target.conversationId,
        threadId: input.event.target.threadId,
        workerId,
        provider,
        providerSessionId: result.providerSessionId,
        result: { contentHash: stored.contentHash, byteCount: stored.byteCount },
        completedAt: result.completedAt,
      });
      return createVerifiedConversationControlReply({
        artifactStore: this.options.artifactStore,
        writingContract: realtimeConversationWritingContract,
        content,
      });
    } catch (error) {
      this.options.store.fail(input.event.eventId, failureCode(error), new Date().toISOString());
      throw error;
    }
  }

  close(): void {
    this.abortController.abort();
    this.options.store.close();
  }
}
