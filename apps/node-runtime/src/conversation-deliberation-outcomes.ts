import type { ConversationApplication } from "@lervo/conversation-app";
import {
  createConversationInboundEvent,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import type {
  ConversationDeliberationResumeWorkerCycleResult,
  ConversationDeliberationStatus,
  ConversationDeliberationWorkerCycleResult,
} from "@lervo/conversation-control";
import type { ArtifactStore } from "@lervo/storage-contract";

type WorkerResult =
  ConversationDeliberationWorkerCycleResult | ConversationDeliberationResumeWorkerCycleResult;

interface PendingReconciliation {
  attempts: number;
}

export class ConversationDeliberationOutcomeCoordinator {
  private readonly pending = new Map<string, PendingReconciliation>();

  constructor(
    private readonly options: {
      projectId: string;
      integrationId: string;
      conversationIds: readonly string[];
      artifactStore: ArtifactStore;
      maximumReconciliationAttempts: number;
      now?(): Date;
    },
  ) {}

  async observe(application: ConversationApplication, result: WorkerResult): Promise<void> {
    if (result.status === "idle") return;
    if (result.status === "uncertain") {
      this.pending.set(result.deliberationId, { attempts: 0 });
      return;
    }
    await this.notify(application, result.deliberationId, result.summary.status);
  }

  async reconcilePending(application: ConversationApplication): Promise<void> {
    for (const [deliberationId, pending] of this.pending) {
      const result = await application.reconcileDeliberation?.({
        projectId: this.options.projectId,
        deliberationId,
      });
      if (result?.status === "reconciled" || result?.status === "not_uncertain") {
        this.pending.delete(deliberationId);
        await this.notify(application, deliberationId, result.summary.status);
        continue;
      }
      pending.attempts += 1;
      if (pending.attempts >= this.options.maximumReconciliationAttempts) {
        this.pending.delete(deliberationId);
        await this.dispatch(
          application,
          deliberationId,
          "deliberation.attention",
          "I could not verify the managed deliberation's terminal state, so I did not retry the execution. The canonical event history and checkpoint need review before it can continue.",
        );
      }
    }
  }

  private async notify(
    application: ConversationApplication,
    deliberationId: string,
    status: ConversationDeliberationStatus,
  ): Promise<void> {
    if (!["interrupted", "converged", "no_consensus", "failed"].includes(status)) {
      throw new Error("The deliberation notification outcome is not terminal or resumable.");
    }
    const description = {
      interrupted:
        "The managed deliberation stopped at a verified resumable checkpoint. It can continue without repeating completed work.",
      converged:
        "The managed deliberation reached a verified decision. Review the current canonical repository state before acting on it.",
      no_consensus:
        "The managed deliberation ended without consensus. No disputed conclusion was promoted as a decision.",
      failed:
        "The managed deliberation ended with a verified failure. Review its recorded evidence before deciding the next action.",
    }[status as "interrupted" | "converged" | "no_consensus" | "failed"];
    await this.dispatch(application, deliberationId, "deliberation.completed", description);
  }

  private async dispatch(
    application: ConversationApplication,
    deliberationId: string,
    signalCode: string,
    content: string,
  ): Promise<void> {
    if (this.options.conversationIds.length === 0) return;
    const artifact = await this.options.artifactStore.put(content);
    for (const conversationId of this.options.conversationIds) {
      await application.handleInboundEvent?.(
        createConversationInboundEvent({
          sourceEventKeyHash: hashConversationSourceEventKey(
            `deliberation-outcome:${deliberationId}:${signalCode}:${conversationId}`,
          ),
          target: {
            integrationId: this.options.integrationId,
            projectId: this.options.projectId,
            conversationId,
            threadId: null,
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
          mentions: { roleIds: [], participantIds: [] },
          replyToEventId: null,
          signalCode,
          automationDepth: 0,
          occurredAt: (this.options.now?.() ?? new Date()).toISOString(),
        }),
      );
      await application.runDeliveryCycle?.(this.options.integrationId);
    }
  }
}
