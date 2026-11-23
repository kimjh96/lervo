import { createLocalProviderWritingEvaluator } from "@lervo/provider-writing-evaluator";
import type { WritingSemanticEvaluator } from "@lervo/writing";

import { createNodeProviderAdapter } from "./managed-provider-runtime.js";
import {
  allowedRoute,
  nodeRoleRoute,
  optionalRouteFields,
  type NodeProviderRoute,
  type ReadNodeModelSelection,
} from "./node-model-route.js";

/**
 * A Node's writing or result evaluator. ADR-0612: evaluation is the `review` role, resolved once
 * per evaluation so its provider and model never come from two reads; the configured evaluation
 * route stands while the role is unset, and a hired agent's provider policy bounds the routes.
 */
export function createConversationReviewEvaluator(input: {
  configured: NodeProviderRoute;
  projectId: string;
  providerPolicy?: "codex" | "claude" | "any" | null | undefined;
  providerExecutables?: Partial<Record<"codex" | "claude", string>>;
  readModelSelection?: ReadNodeModelSelection;
  createId(prefix: "run" | "ses" | "envelope" | "turn"): string;
}): WritingSemanticEvaluator {
  return createLocalProviderWritingEvaluator({
    provider: () =>
      nodeRoleRoute({
        role: "review",
        configured: {
          provider: input.configured.provider,
          ...optionalRouteFields(input.configured),
        },
        ...allowedRoute(input.providerPolicy),
        ...(input.providerExecutables === undefined
          ? {}
          : { executables: input.providerExecutables }),
        ...(input.readModelSelection === undefined
          ? {}
          : { readSelection: input.readModelSelection }),
      }),
    projectId: input.projectId,
    createAdapter: (adapterInput) =>
      createNodeProviderAdapter({
        ...adapterInput,
        ...(input.providerExecutables?.[adapterInput.provider] === undefined
          ? {}
          : { executable: input.providerExecutables[adapterInput.provider] }),
      }),
    createId: input.createId,
    now: () => new Date(),
  });
}
