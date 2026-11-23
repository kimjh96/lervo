import {
  durableInstructionCrossCheckInstruction,
  durableInstructionCrossCheckRequest,
  parseDurableInstructionCrossCheckResponse,
  type DurableInstructionCrossCheckVerdict,
  type GroundedDurableInstruction,
} from "@lervo/repository-knowledge";
import { createNoCapabilityProviderJsonRunner } from "@lervo/repository-knowledge-compiler";

import {
  modelCallOptions,
  readHostSelection,
  type ReadModelSelection,
} from "./model-role-routes.js";

/** Explicit intake runs outside any hook; the check gets the same bound as grounding. */
const CROSS_CHECK_TIMEOUT_MS = 120_000;

/**
 * ADR-0561 fidelity check for an explicitly submitted owner rule whose stored text is a model
 * restatement. It runs in a fresh no-capability provider session, so it shares no session or
 * conversation with the grounding call that wrote the rule. The `review` route for the provider
 * sets its model and effort (ADR-0612). Any failure is a typed rejection; the
 * caller then keeps the rule for background retry instead of storing an unchecked restatement.
 */
export async function crossCheckDurableInstruction(input: {
  provider: "codex" | "claude";
  ownerText: string;
  instruction: GroundedDurableInstruction;
  readSelection?: ReadModelSelection;
}): Promise<DurableInstructionCrossCheckVerdict> {
  const selection = await (input.readSelection ?? readHostSelection)();
  const runner = await createNoCapabilityProviderJsonRunner({
    provider: input.provider,
    ...modelCallOptions(selection, "review", input.provider),
    systemPrompt: durableInstructionCrossCheckInstruction,
    timeoutMs: CROSS_CHECK_TIMEOUT_MS,
  });
  return parseDurableInstructionCrossCheckResponse(
    await runner.resolve(
      durableInstructionCrossCheckRequest({
        ownerText: input.ownerText,
        precedingAgentTurn: null,
        instruction: input.instruction,
      }),
    ),
  );
}

export type CrossCheckDurableInstruction = typeof crossCheckDurableInstruction;
