import type { ConversationApplication } from "@lervo/conversation-app";
import {
  createConversationInboundEvent,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import type {
  ConversationDeliberationOriginReference,
  ConversationDeliberationResumeWorkerCycleResult,
  ConversationDeliberationSummary,
  ConversationDeliberationWorkerCycleResult,
} from "@lervo/conversation-control";
import type { ArtifactStore } from "@lervo/storage-contract";

import type { ConversationDeliberationResultSource } from "./conversation-deliberation-result-source.js";

type WorkerResult =
  ConversationDeliberationWorkerCycleResult | ConversationDeliberationResumeWorkerCycleResult;

interface PendingReconciliation {
  attempts: number;
  uncertainAt: string;
}

type ClaimedNotification = NonNullable<
  Awaited<ReturnType<ConversationApplication["claimDeliberationNotification"]>>
>;

function failedDeliberationMessage(
  code: string | null | undefined,
  responseLanguage: "en" | "ko",
): string {
  const ko: Record<string, string> = {
    deliberation_budget_exhausted:
      "완료와 검증에 필요한 실행 예산을 확보하지 못해 검토를 중단했습니다. 부분 결과는 채택하지 않았으며, 같은 구성으로 자동 재시도하지 않습니다.",
    deliberation_participant_binding_invalid:
      "검토에 참여할 실제 에이전트의 바인딩을 끝까지 확인하지 못해 중단했습니다. 정책 역할을 다른 에이전트가 대신 연기하지 않았고 부분 결과도 채택하지 않았습니다.",
  };
  const en: Record<string, string> = {
    deliberation_budget_exhausted:
      "The review stopped because it could not preserve enough execution budget for completion and verification. No partial result was adopted, and the same configuration will not be retried automatically.",
    deliberation_participant_binding_invalid:
      "The review stopped because the actual agent binding could not be verified through completion. No other agent impersonated the policy role, and no partial result was adopted.",
  };
  const message = (responseLanguage === "ko" ? ko : en)[code ?? ""];
  if (message !== undefined) return message;
  return responseLanguage === "ko"
    ? `검토를 완료하지 못했습니다${code == null ? "" : ` (${code})`}. 부분 결과는 채택하지 않았고 같은 실행을 자동 반복하지 않습니다.`
    : `The review did not complete${code == null ? "" : ` (${code})`}. No partial result was adopted, and the same execution will not be repeated automatically.`;
}

export class ConversationDeliberationOutcomeCoordinator {
  private readonly pending = new Map<string, PendingReconciliation>();
  private readonly exhausted = new Set<string>();

  constructor(
    private readonly options: {
      projectId: string;
      integrationId: string;
      conversationIds: readonly string[];
      artifactStore: ArtifactStore;
      resultSource: ConversationDeliberationResultSource;
      maximumReconciliationAttempts: number;
      now?(): Date;
    },
  ) {}

  get hasPending(): boolean {
    return this.pending.size > 0;
  }

  async observe(application: ConversationApplication, result: WorkerResult): Promise<void> {
    if (result.status === "idle") return;
    if (result.status === "uncertain") {
      this.pending.set(result.deliberationId, {
        attempts: 0,
        uncertainAt: result.uncertainAt,
      });
      return;
    }
    await this.drain(application);
  }

  async reconcilePending(application: ConversationApplication): Promise<void> {
    const uncertain = await application.listUncertainDeliberations({
      projectId: this.options.projectId,
      limit: 100,
    });
    for (const item of uncertain) {
      if (!this.pending.has(item.deliberationId) && !this.exhausted.has(item.deliberationId)) {
        this.pending.set(item.deliberationId, { attempts: 0, uncertainAt: item.uncertainAt });
      }
    }
    for (const [deliberationId, pending] of this.pending) {
      const result = await application.reconcileDeliberation?.({
        projectId: this.options.projectId,
        deliberationId,
      });
      if (result?.status === "reconciled" || result?.status === "not_uncertain") {
        this.pending.delete(deliberationId);
        continue;
      }
      pending.attempts += 1;
      if (pending.attempts >= this.options.maximumReconciliationAttempts) {
        await this.dispatchAttention(
          application,
          deliberationId,
          "deliberation.attention",
          pending.uncertainAt,
        );
        this.pending.delete(deliberationId);
        this.exhausted.add(deliberationId);
      }
    }
    await this.drain(application);
  }

  async drain(application: ConversationApplication): Promise<void> {
    for (let index = 0; index < 16; index += 1) {
      const claimed = await application.claimDeliberationNotification();
      if (claimed === null) return;
      await this.dispatchNotification(application, claimed);
    }
  }

  private async notificationContent(
    summary: ConversationDeliberationSummary,
    responseLanguage: "en" | "ko",
  ): Promise<string> {
    const { status } = summary;
    if (!["interrupted", "converged", "no_consensus", "failed"].includes(status)) {
      throw new Error("The deliberation notification outcome is not terminal or resumable.");
    }
    if (status === "interrupted") {
      return responseLanguage === "ko"
        ? "검토가 안전한 체크포인트에서 일시 중단됐습니다. 완료된 작업을 반복하지 않고 이어갈 수 있습니다."
        : "The review paused at a safe checkpoint. It can continue without repeating completed work.";
    }
    if (status === "failed") {
      return failedDeliberationMessage(summary.failureReasonCode, responseLanguage);
    }
    const result = await this.options.resultSource.read({
      projectId: this.options.projectId,
      deliberationId: summary.deliberationId,
    });
    if (result.status !== status || result.content === null) {
      throw new Error("The published deliberation result does not match the terminal outcome.");
    }
    if (status === "converged") {
      return responseLanguage === "ko"
        ? `이해관계자별 독립 검토가 검증된 결론에 도달했습니다.\n\n${result.content}`
        : `The independent review reached a verified decision.\n\n${result.content}`;
    }
    return responseLanguage === "ko"
      ? `이해관계자별 독립 검토가 합의에 도달하지 못했습니다. 이견이 있는 결론은 채택하지 않았습니다.\n\n${result.content}`
      : `The independent review ended without consensus, so no disputed conclusion was accepted.\n\n${result.content}`;
  }

  private async dispatchNotification(
    application: ConversationApplication,
    claimed: ClaimedNotification,
  ): Promise<void> {
    const eventIds = await this.dispatch(
      application,
      claimed.notification.deliberationId,
      `completed:${claimed.notification.summary.status}`,
      "deliberation.completed",
      await this.notificationContent(
        claimed.notification.summary,
        claimed.origin?.responseLanguage ?? "en",
      ),
      claimed.notification.occurredAt,
      claimed.origin,
    );
    await application.acceptDeliberationNotification({
      operation: claimed.notification.operation,
      deliberationId: claimed.notification.deliberationId,
      leaseId: claimed.leaseId,
      conversationEventId: eventIds[0]!,
    });
    await application.runDeliveryCycle?.(this.options.integrationId);
  }

  private async dispatchAttention(
    application: ConversationApplication,
    deliberationId: string,
    signalCode: string,
    occurredAt: string,
  ): Promise<void> {
    const origin = await application.inspectDeliberationOrigin({
      projectId: this.options.projectId,
      deliberationId,
    });
    await this.dispatch(
      application,
      deliberationId,
      "attention",
      signalCode,
      origin?.responseLanguage === "ko"
        ? "검토의 최종 상태를 안전하게 확인할 수 없어 재실행하지 않고 중단했습니다. 부분 결과는 최종 결정으로 채택하지 않았습니다."
        : "I couldn't complete this review safely. I stopped without retrying and did not treat any partial result as a decision.",
      occurredAt,
      origin,
      true,
    );
    await application.runDeliveryCycle?.(this.options.integrationId);
  }

  private async dispatch(
    application: ConversationApplication,
    deliberationId: string,
    notificationKey: string,
    signalCode: string,
    content: string,
    occurredAt: string,
    origin: ConversationDeliberationOriginReference | null,
    suppressExistingSourceKey = false,
  ): Promise<string[]> {
    const targets =
      origin === null
        ? this.options.conversationIds.map((conversationId) => ({
            conversationId,
            threadId: null,
            replyToEventId: null,
            requesterParticipantId: null,
          }))
        : [
            {
              conversationId: origin.conversationId,
              threadId: origin.threadId,
              replyToEventId: origin.sourceEventId,
              requesterParticipantId: origin.requesterParticipantId,
            },
          ];
    if (targets.length === 0) {
      throw new Error("The deliberation notification has no origin or configured fallback.");
    }
    if (application.handleInboundEvent === null) {
      throw new Error("The deliberation notification interaction runtime is unavailable.");
    }
    const artifact = await this.options.artifactStore.put(content);
    const eventIds: string[] = [];
    for (const target of targets) {
      const sourceEventKeyHash = hashConversationSourceEventKey(
        JSON.stringify([
          "deliberation-outcome",
          1,
          deliberationId,
          notificationKey,
          target.conversationId,
          target.threadId,
          target.replyToEventId,
        ]),
      );
      if (
        suppressExistingSourceKey &&
        application.hasConversationSourceEventKeyHash(sourceEventKeyHash)
      ) {
        continue;
      }
      const event = createConversationInboundEvent({
        sourceEventKeyHash,
        target: {
          integrationId: this.options.integrationId,
          projectId: this.options.projectId,
          conversationId: target.conversationId,
          threadId: target.threadId,
        },
        kind: "signal.raised",
        actor: {
          kind: "system",
          participantId: "ptc_lervo_system",
          roleId: null,
          agentBinding: null,
        },
        content: {
          artifactId: `art_${artifact.contentHash.slice("sha256:".length, 60)}`,
          contentHash: artifact.contentHash,
          byteCount: artifact.byteCount,
          mediaType: "text/plain; charset=utf-8",
        },
        mentions: {
          roleIds: [],
          participantIds:
            target.requesterParticipantId === null ? [] : [target.requesterParticipantId],
        },
        replyToEventId: target.replyToEventId,
        signalCode,
        automationDepth: 0,
        occurredAt,
      });
      const results = await application.handleInboundEvent(event);
      const responding = results.filter(
        (result) => "outbound" in result.result && result.result.outbound !== null,
      );
      if (responding.length !== 1) {
        throw new Error(
          "Exactly one conversation policy must create the deliberation notification outbound.",
        );
      }
      eventIds.push(event.eventId);
    }
    return eventIds;
  }
}
