import { resolve } from "node:path";

import {
  handleConversationEvent,
  runConversationDeliveryCycle,
  type ConversationDeliveryCycleResult,
  type HandleConversationEventResult,
} from "@lervo/interaction";
import type { ConversationResponseActivity } from "@lervo/interaction";
import { SQLiteConversationInteractionStore } from "@lervo/interaction-sqlite";
import type { ConversationInboundEvent } from "@lervo/schemas";

import type { ConversationInteractionBinding, ConversationInteractionDeployment } from "./types.js";
import { ConversationResponseActivityRegistry } from "./response-activity.js";

export interface ConversationInteractionResult {
  policyId: string;
  roleId: string;
  result: HandleConversationEventResult;
}

export interface ConversationInteractionRetryCycleResult {
  status: "idle" | "processed";
  attemptedCount: number;
  results: ConversationInteractionResult[];
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
  private readonly responseActivities = new ConversationResponseActivityRegistry();

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

  nextWakeupAt(integrationId: string): number | null {
    return this.store.nextWakeupAt(
      integrationId,
      this.deployment.bindings.map(({ policy }) => ({
        policyId: policy.policyId,
        roleId: policy.roleId,
      })),
    );
  }

  async handle(
    event: ConversationInboundEvent,
    responseActivity?: ConversationResponseActivity,
  ): Promise<ConversationInteractionResult[]> {
    const bindings = this.deployment.bindings.filter(
      (binding) =>
        binding.policy.projectId === event.target.projectId &&
        binding.policy.conversationIds.includes(event.target.conversationId),
    );
    const results: ConversationInteractionResult[] = [];
    const trackedActivity = this.responseActivities.bind(
      event.eventId,
      bindings.map((binding) => ({
        policyId: binding.policy.policyId,
        roleId: binding.policy.roleId,
      })),
      responseActivity,
    );
    try {
      for (const binding of bindings) {
        const result = await this.handleBinding(event, binding, trackedActivity);
        results.push(result);
        this.responseActivities.settle(event.eventId, result, result.result);
      }
    } catch (error) {
      this.responseActivities.abort(event.eventId);
      throw error;
    }
    return results;
  }

  async runRetryCycle(
    integrationId: string,
    limit = 1,
  ): Promise<ConversationInteractionRetryCycleResult> {
    const at = (this.deployment.now?.() ?? new Date()).toISOString();
    const ready = this.deployment.bindings
      .flatMap((binding) =>
        this.store.readyInbound({
          integrationId,
          policyId: binding.policy.policyId,
          roleId: binding.policy.roleId,
          at,
          limit,
        }),
      )
      .toSorted((left, right) => {
        const occurred = left.event.occurredAt.localeCompare(right.event.occurredAt);
        return occurred === 0 ? left.event.eventId.localeCompare(right.event.eventId) : occurred;
      })
      .slice(0, limit);
    const results: ConversationInteractionResult[] = [];
    for (const candidate of ready) {
      const binding = this.deployment.bindings.find(
        (item) =>
          item.policy.policyId === candidate.policyId && item.policy.roleId === candidate.roleId,
      );
      if (binding === undefined) continue;
      const trackedActivity = this.responseActivities.bind(candidate.event.eventId, [], undefined);
      try {
        const result = await this.handleBinding(candidate.event, binding, trackedActivity);
        results.push(result);
        this.responseActivities.settle(candidate.event.eventId, result, result.result);
      } catch (error) {
        this.responseActivities.abort(candidate.event.eventId);
        throw error;
      }
    }
    return {
      status: results.length === 0 ? "idle" : "processed",
      attemptedCount: results.length,
      results,
    };
  }

  private async handleBinding(
    event: ConversationInboundEvent,
    binding: ConversationInteractionBinding,
    responseActivity?: ConversationResponseActivity,
  ): Promise<ConversationInteractionResult> {
    const result = await handleConversationEvent({
      event,
      policy: binding.policy,
      workerId: this.deployment.workerId,
      agentParticipantId: binding.agentParticipantId,
      ...(binding.agentBinding === undefined ? {} : { agentBinding: binding.agentBinding }),
      store: this.store,
      responder: binding.responder,
      publicationVerifier: binding.publicationVerifier,
      ...(binding.relevanceEvaluator === undefined
        ? {}
        : { relevanceEvaluator: binding.relevanceEvaluator }),
      ...(binding.turnOwnershipEvaluator === undefined
        ? {}
        : { turnOwnershipEvaluator: binding.turnOwnershipEvaluator }),
      ...(this.deployment.now === undefined ? {} : { clock: this.deployment.now }),
      ...(this.deployment.leaseDurationMs === undefined
        ? {}
        : { leaseDurationMs: this.deployment.leaseDurationMs }),
      ...(this.deployment.retryDelayMs === undefined
        ? {}
        : { retryDelayMs: this.deployment.retryDelayMs }),
      ...(this.deployment.maximumResponseAttempts === undefined
        ? {}
        : { maximumResponseAttempts: this.deployment.maximumResponseAttempts }),
      ...(binding.responseFailureClassifier === undefined
        ? {}
        : { responseFailureClassifier: binding.responseFailureClassifier }),
      ...(binding.terminalFailureResponder === undefined
        ? {}
        : { terminalFailureResponder: binding.terminalFailureResponder }),
      ...(binding.terminalFailurePublicationVerifier === undefined
        ? {}
        : {
            terminalFailurePublicationVerifier: binding.terminalFailurePublicationVerifier,
          }),
      ...(responseActivity === undefined ? {} : { responseActivity }),
    });
    return {
      policyId: binding.policy.policyId,
      roleId: binding.policy.roleId,
      result,
    };
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
      ...(this.deployment.onDelivered === undefined
        ? {}
        : { onDelivered: this.deployment.onDelivered }),
    });
  }

  close(): void {
    this.responseActivities.close();
    this.store.close();
  }
}
