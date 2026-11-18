import {
  durableInstructionCrossCheckInstruction,
  durableInstructionCrossCheckRequest,
  parseDurableInstructionCrossCheckResponse,
  type DurableInstructionCrossCheckVerdict,
  type GroundedDurableInstruction,
} from "@lervo/repository-knowledge";
import { createNoCapabilityProviderJsonRunner } from "@lervo/repository-knowledge-compiler";

/** Explicit intake runs outside any hook; the check gets the same bound as grounding. */
const CROSS_CHECK_TIMEOUT_MS = 120_000;

/**
 * ADR-0561 fidelity check for an explicitly submitted owner rule whose stored text is a model
 * restatement. It runs in a fresh no-capability provider session, so it shares no session or
 * conversation with the grounding call that wrote the rule. Any failure is a typed rejection; the
 * caller then keeps the rule for background retry instead of storing an unchecked restatement.
 */
export async function crossCheckDurableInstruction(input: {
  provider: "codex" | "claude";
  ownerText: string;
  instruction: GroundedDurableInstruction;
}): Promise<DurableInstructionCrossCheckVerdict> {
  const runner = await createNoCapabilityProviderJsonRunner({
    provider: input.provider,
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
