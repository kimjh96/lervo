import { writingContractForLanguage } from "@lervo/core";
import { deliberationPolicyHash } from "@lervo/deliberation";
import { readDeliberationPolicyEvent } from "@lervo/product-surface-projection";
import { loadRepositoryKnowledgePolicy } from "@lervo/repository-knowledge";
import type {
  DeliberationPolicy,
  DeliberationStartedEventPayload,
  EventEnvelope,
} from "@lervo/schemas";

import { loadDeliberationWorkflowSource } from "./deliberation-policy-loader.js";
import { createStoredDeliberationExecutionPlan } from "./deliberation-roles.js";

export class ProductDeliberationSourceError extends Error {
  constructor(
    readonly code:
      | "deliberation_not_found"
      | "deliberation_source_unavailable"
      | "deliberation_source_invalid"
      | "deliberation_source_changed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProductDeliberationSourceError";
  }
}

export interface ProductDeliberationPolicyDependencies {
  loadCurrentPolicy(
    repositoryRoot: string,
    projectId: string,
    policyId: string,
  ): Promise<DeliberationPolicy>;
}

export const defaultProductDeliberationPolicyDependencies: ProductDeliberationPolicyDependencies = {
  loadCurrentPolicy: async (repositoryRoot, projectId, policyId) => {
    const [source, knowledgePolicy] = await Promise.all([
      loadDeliberationWorkflowSource(repositoryRoot, policyId),
      loadRepositoryKnowledgePolicy(repositoryRoot),
    ]);
    return createStoredDeliberationExecutionPlan({
      projectId,
      source,
      writingContract: writingContractForLanguage(knowledgePolicy.publication.language),
    }).policy;
  },
};

export async function resolveProductDeliberationPolicy(input: {
  repositoryRoot: string;
  projectId: string;
  deliberationId: string;
  policyId: string;
  events: readonly EventEnvelope[];
  dependencies?: ProductDeliberationPolicyDependencies;
}): Promise<{
  policy: DeliberationPolicy;
  startedEvent: EventEnvelope & {
    type: "deliberation.started";
    payload: DeliberationStartedEventPayload;
  };
}> {
  const source = readDeliberationPolicyEvent(input);
  if (source.status === "invalid") {
    throw new ProductDeliberationSourceError(
      "deliberation_source_invalid",
      "The embedded deliberation policy contradicts its start event.",
    );
  }
  const startedEvent = input.events.find((event) => event.eventId === source.startedEventId);
  if (startedEvent?.type !== "deliberation.started") {
    throw new ProductDeliberationSourceError(
      "deliberation_source_unavailable",
      "The canonical deliberation start event is unavailable.",
    );
  }
  const policy =
    source.status === "complete"
      ? source.policy
      : await (
          input.dependencies ?? defaultProductDeliberationPolicyDependencies
        ).loadCurrentPolicy(input.repositoryRoot, input.projectId, input.policyId);
  if (
    policy.policyId !== input.policyId ||
    policy.projectId !== input.projectId ||
    deliberationPolicyHash(policy) !== startedEvent.payload.policyHash
  ) {
    throw new ProductDeliberationSourceError(
      "deliberation_source_unavailable",
      "The current policy cannot exactly reconstruct the legacy deliberation start.",
    );
  }
  return {
    policy,
    startedEvent: startedEvent as EventEnvelope & {
      type: "deliberation.started";
      payload: DeliberationStartedEventPayload;
    },
  };
}
