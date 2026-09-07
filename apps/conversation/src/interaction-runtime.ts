import { resolve } from "node:path";

import {
  handleConversationEvent,
  runConversationDeliveryCycle,
  type ConversationDeliveryCycleResult,
  type HandleConversationEventResult,
} from "@lervo/interaction";
import { SQLiteConversationInteractionStore } from "@lervo/interaction-sqlite";
import type { ConversationInboundEvent } from "@lervo/schemas";

import type { ConversationInteractionBinding, ConversationInteractionDeployment } from "./types.js";

export interface ConversationInteractionResult {
  policyId: string;
  roleId: string;
  result: HandleConversationEventResult;
}

function validateBindings(bindings: readonly ConversationInteractionBinding[]): void {
  const policyIds = bindings.map((binding) => binding.policy.policyId);
  if (bindings.length === 0 || new Set(policyIds).size !== policyIds.length) {
    throw new Error("Conversation interaction policies must be non-empty and unique.");
  }
  if (
    bindings.some(
      (binding) =>
        binding.agentParticipantId === binding.policy.roleId ||
        !/^ptc_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(binding.agentParticipantId),
    )
  ) {
    throw new Error("Conversation interaction participant bindings are invalid.");
  }
}

export class ConversationInteractionRuntime {
  private constructor(
    private readonly deployment: ConversationInteractionDeployment,
    private readonly store: SQLiteConversationInteractionStore,
  ) {}

  static async open(input: {
    dataDirectory: string;
    deployment: ConversationInteractionDeployment;
  }): Promise<ConversationInteractionRuntime> {
    validateBindings(input.deployment.bindings);
    const store = await SQLiteConversationInteractionStore.open({
      path: resolve(input.dataDirectory, "interactions.sqlite"),
      ...(input.deployment.maxRecords === undefined
        ? {}
        : { maxRecords: input.deployment.maxRecords }),
    });
    return new ConversationInteractionRuntime(input.deployment, store);
  }

  async handle(event: ConversationInboundEvent): Promise<ConversationInteractionResult[]> {
    const bindings = this.deployment.bindings.filter(
      (binding) =>
        binding.policy.projectId === event.target.projectId &&
        binding.policy.conversationIds.includes(event.target.conversationId),
    );
    const results: ConversationInteractionResult[] = [];
    for (const binding of bindings) {
      const result = await handleConversationEvent({
        event,
        policy: binding.policy,
        workerId: this.deployment.workerId,
        agentParticipantId: binding.agentParticipantId,
        store: this.store,
        responder: binding.responder,
        publicationVerifier: binding.publicationVerifier,
        ...(binding.relevanceEvaluator === undefined
          ? {}
          : { relevanceEvaluator: binding.relevanceEvaluator }),
        ...(this.deployment.now === undefined ? {} : { clock: this.deployment.now }),
        ...(this.deployment.leaseDurationMs === undefined
          ? {}
          : { leaseDurationMs: this.deployment.leaseDurationMs }),
        ...(this.deployment.retryDelayMs === undefined
          ? {}
          : { retryDelayMs: this.deployment.retryDelayMs }),
      });
      results.push({
        policyId: binding.policy.policyId,
        roleId: binding.policy.roleId,
        result,
      });
    }
    return results;
  }

  runDeliveryCycle(
    adapter: Parameters<typeof runConversationDeliveryCycle>[0]["adapter"],
  ): Promise<ConversationDeliveryCycleResult> {
    return runConversationDeliveryCycle({
      adapter,
      store: this.store,
      workerId: `${this.deployment.workerId}:delivery`,
      ...(this.deployment.now === undefined ? {} : { clock: this.deployment.now }),
      ...(this.deployment.leaseDurationMs === undefined
        ? {}
        : { leaseDurationMs: this.deployment.leaseDurationMs }),
      ...(this.deployment.retryDelayMs === undefined
        ? {}
        : { retryDelayMs: this.deployment.retryDelayMs }),
      ...(this.deployment.deliveryLimit === undefined
        ? {}
        : { limit: this.deployment.deliveryLimit }),
    });
  }

  close(): void {
    this.store.close();
  }
}
