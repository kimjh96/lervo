import type { ConversationAdapter } from "@lervo/conversation-contract";
import type { RemoteCommandDeliveryAcknowledgement, RemoteCommandLease } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import type { WritingSemanticEvaluator } from "@lervo/writing";

import {
  createConversationResultCandidate,
  createConversationResultOutbound,
  verifyConversationResultCandidate,
} from "./conversation-result-publication.js";
import type {
  ConversationResultCycleResult,
  ConversationResultOrigin,
  ConversationResultSource,
  ConversationResultStore,
} from "./conversation-result-types.js";

function validTime(now: () => Date): string {
  const value = now();
  if (!Number.isFinite(value.getTime()))
    throw new Error("The conversation result clock is invalid.");
  return value.toISOString();
}

function failureCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[a-z][a-z0-9_]{0,63}$/u.test(error.code)
  ) {
    return error.code;
  }
  return "result_publication_failed";
}

export class ConversationResultRuntime {
  constructor(
    private readonly options: {
      workerId: string;
      store: ConversationResultStore;
      artifacts: ArtifactStore;
      adapter: ConversationAdapter;
      semanticEvaluator: WritingSemanticEvaluator;
      source: ConversationResultSource;
      now?: () => Date;
      leaseDurationMs?: number;
      retryDelayMs?: number;
    },
  ) {}

  register(origin: ConversationResultOrigin): Promise<"created" | "duplicate"> {
    return this.options.store.register(origin);
  }

  observe(input: {
    lease: RemoteCommandLease;
    acknowledgement: RemoteCommandDeliveryAcknowledgement;
  }) {
    return this.options.store.observeTerminal({
      lease: structuredClone(input.lease),
      terminal: {
        acknowledgement: structuredClone(input.acknowledgement),
        observedAt: input.acknowledgement.acknowledgedAt,
      },
    });
  }

  async runCycle(): Promise<ConversationResultCycleResult> {
    const now = this.options.now ?? (() => new Date());
    const claimedAt = validTime(now);
    const lease = await this.options.store.claim({
      workerId: this.options.workerId,
      claimedAt,
      leaseDurationMs: this.options.leaseDurationMs ?? 120_000,
    });
    if (lease === null) return { status: "idle" };
    try {
      let candidate = lease.candidate;
      let outbound = lease.outbound;
      if (candidate === null || outbound === null) {
        candidate = await createConversationResultCandidate({
          source: this.options.source,
          artifacts: this.options.artifacts,
          lease,
          semanticEvaluator: this.options.semanticEvaluator,
          now,
        });
        const permitTime = Date.parse(candidate.publicationPermit.issuedAt);
        const createdAt = new Date(Math.max(Date.parse(validTime(now)), permitTime)).toISOString();
        outbound = createConversationResultOutbound({ lease, candidate, createdAt });
        await this.options.store.prepare({
          deliveryId: lease.origin.deliveryId,
          leaseId: lease.leaseId,
          candidate,
          outbound,
        });
      }
      await verifyConversationResultCandidate({ artifacts: this.options.artifacts, candidate });
      const receipt = await this.options.adapter.deliver(outbound);
      await this.options.store.acknowledge({
        deliveryId: lease.origin.deliveryId,
        leaseId: lease.leaseId,
        deliveredAt: receipt.deliveredAt,
      });
      return {
        status: "delivered",
        deliveryId: lease.origin.deliveryId,
        outboundId: outbound.outboundId,
      };
    } catch (error) {
      const failedAt = validTime(now);
      const nextAttemptAt = new Date(
        Date.parse(failedAt) + (this.options.retryDelayMs ?? 5_000),
      ).toISOString();
      const code = failureCode(error);
      await this.options.store.reschedule({
        deliveryId: lease.origin.deliveryId,
        leaseId: lease.leaseId,
        failedAt,
        availableAt: nextAttemptAt,
        failureCode: code,
      });
      return {
        status: "retry_scheduled",
        deliveryId: lease.origin.deliveryId,
        failureCode: code,
        nextAttemptAt,
      };
    }
  }

  close(): void {
    this.options.store.close();
  }
}
