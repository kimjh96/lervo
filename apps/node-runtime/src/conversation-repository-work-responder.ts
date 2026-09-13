import { executionInstructions, fitDiscord } from "./conversation-repository-work-writing.js";
import { createHash } from "node:crypto";

import type { RepositoryWorkTurnExecutor } from "@lervo/adapter-contract";
import {
  readConversationControlMessage,
  createVerifiedConversationControlReply,
} from "@lervo/conversation-control";
import { realtimeConversationWritingContract } from "@lervo/core";
import type { ConversationResponder } from "@lervo/interaction";
import type { ArtifactStore } from "@lervo/storage-contract";

import { SQLiteConversationRepositoryWorkStore } from "./conversation-repository-work-store.js";
import {
  changedRepositoryWorkPaths,
  observeRepositoryWork,
} from "./repository-work-observation.js";
import { awaitRepositoryReplicaReadiness } from "./repository-replica-readiness.js";
import {
  captureConversationRepositoryWorkCompletionBaseline,
  verifyConversationRepositoryWorkCompletion,
} from "./conversation-repository-work-completion.js";

class ConversationRepositoryWorkStageError extends Error {
  constructor(
    readonly code: "repository_observation_failed" | "repository_result_storage_failed",
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
      executors: Partial<Record<"codex" | "claude", RepositoryWorkTurnExecutor>>;
      models?: Partial<Record<"codex" | "claude", string>>;
      reasoningEfforts?: Partial<
        Record<"codex" | "claude", "low" | "medium" | "high" | "xhigh" | "max">
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
        verify: typeof verifyConversationRepositoryWorkCompletion;
      };
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

  async respond(input: Parameters<ConversationResponder["respond"]>[0]) {
    const request = await readConversationControlMessage({
      artifactStore: this.options.artifactStore,
      event: input.event,
    });
    if (request.trim().length === 0 || request.length > 16_384 || request.includes("\0")) {
      throw new Error("The repository work request is empty or exceeds its text bound.");
    }
    const startedAt = new Date().toISOString();
    const delegate = this.options.store.activeDelegate(
      input.event.target.conversationId,
      input.event.target.threadId,
    );
    const provider =
      delegate === null || delegate.provider === "any"
        ? this.options.defaultProvider
        : delegate.provider;
    const executor = this.options.executors[provider];
    if (executor === undefined) {
      throw new Error(`The ${provider} repository work executor is not configured.`);
    }
    const turn = this.options.store.begin({
      eventId: input.event.eventId,
      conversationId: input.event.target.conversationId,
      threadId: input.event.target.threadId,
      workerId: delegate?.agentId ?? this.options.parentAgentId,
      provider,
      requestContentHash: input.event.content.contentHash,
      startedAt,
    });
    if (turn.duplicate === "in_progress") {
      return createVerifiedConversationControlReply({
        artifactStore: this.options.artifactStore,
        writingContract: realtimeConversationWritingContract,
        content:
          "동일한 요청은 이미 진행 중입니다. 중복 실행하지 않고 기존 작업의 완료 결과를 이 대화에 남기겠습니다.",
      });
    }
    if (turn.completed !== null) {
      const content = await readStoredResult(this.options.artifactStore, turn.completed);
      return createVerifiedConversationControlReply({
        artifactStore: this.options.artifactStore,
        writingContract: realtimeConversationWritingContract,
        content:
          turn.duplicate === "completed"
            ? fitDiscord(
                `동일한 요청은 최근에 이미 완료되어 다시 실행하지 않았습니다.\n\n${content}`,
              )
            : content,
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
      const completionLifecycle = this.options.completionLifecycle ?? {
        capture: captureConversationRepositoryWorkCompletionBaseline,
        verify: verifyConversationRepositoryWorkCompletion,
      };
      const completionBaseline = await completionLifecycle.capture(this.options.repositoryRoot);
      const before = await observe(this.options.repositoryRoot);
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
                workerId: delegate?.agentId ?? this.options.parentAgentId,
                limit: 8,
              })
              .map((reference) => readStoredResult(this.options.artifactStore, reference)),
          ),
          worker: delegate,
          externalEffectsAuthorized,
        }),
        providerSessionId: turn.providerSessionId,
        ...(this.options.models?.[provider] === undefined
          ? {}
          : { model: this.options.models[provider] }),
        ...(this.options.reasoningEfforts?.[provider] === undefined
          ? {}
          : { reasoningEffort: this.options.reasoningEfforts[provider] }),
        ...(externalEffectsAuthorized ? { externalEffectsAuthorized: true } : {}),
        timeoutMs: this.options.timeoutMs,
        signal: this.abortController.signal,
      });
      const after = await observe(this.options.repositoryRoot);
      const changedPaths = await changedRepositoryWorkPaths({
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
      if (changedPaths.length > 0 && this.options.repositoryReplica !== undefined) {
        await awaitRepositoryReplicaReadiness({
          repositoryRoot: this.options.repositoryRoot,
          maximumStalenessMs: this.options.repositoryReplica.maximumStalenessMs,
          waitTimeoutMs: this.options.repositoryReplica.waitTimeoutMs,
          pollIntervalMs: this.options.repositoryReplica.pollIntervalMs,
        });
      }
      await completionLifecycle.verify({
        repositoryRoot: this.options.repositoryRoot,
        provider,
        baseline: completionBaseline,
        changedPaths,
        sourceConversationEventId: input.event.eventId,
        workerAgentId: delegate?.agentId ?? this.options.parentAgentId,
        providerSessionId: result.providerSessionId,
        requestedModel: this.options.models?.[provider] ?? null,
        requestedReasoningEffort: this.options.reasoningEfforts?.[provider] ?? null,
        requestContentHash: input.event.content.contentHash,
        result: { contentHash: stored.contentHash, byteCount: stored.byteCount },
        completedAt: result.completedAt,
        replicaConfigured: this.options.repositoryReplica !== undefined,
      });
      this.options.store.complete({
        eventId: input.event.eventId,
        conversationId: input.event.target.conversationId,
        threadId: input.event.target.threadId,
        workerId: delegate?.agentId ?? this.options.parentAgentId,
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
