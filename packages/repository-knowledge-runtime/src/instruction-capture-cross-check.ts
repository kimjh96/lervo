import {
  durableInstructionCrossCheckInstruction,
  durableInstructionCrossCheckRequest,
  durableInstructionIsOwnerWording,
  parseDurableInstructionCrossCheckResponse,
  type GroundedDurableInstruction,
} from "@lervo/repository-knowledge";

import {
  runGovernedCaptureCall,
  type InstructionCaptureAssessmentCall,
  type InstructionCaptureContext,
} from "./instruction-capture-assessment.js";
import type { QueuedInstructionCapture } from "./instruction-capture-queue.js";

export const INSTRUCTION_CROSS_CHECK_STAGE = "instruction_cross_check";

export type CapturedInstructionCrossCheck =
  | { status: "agree" | "disagree"; reasonIds: string[]; tokens: number }
  | { status: "owner_wording" }
  | Extract<InstructionCaptureAssessmentCall, { status: "deferred" | "failed" }>;

/**
 * ADR-0561: before a captured rule is stored, an independent no-capability session that did not
 * write it compares it with the owner turn. A rule whose text is the owner's own wording needs no
 * model check. Only a valid `agree` lets the rule be stored.
 */
export async function crossCheckCapturedInstruction(input: {
  context: InstructionCaptureContext;
  capture: QueuedInstructionCapture;
  instruction: GroundedDurableInstruction;
  catalogEntries: ReadonlyArray<{ path: string; contentHash: string; excerpt: string }>;
  sourceRevision: string;
}): Promise<CapturedInstructionCrossCheck> {
  if (
    input.instruction.authority === "explicit_user" &&
    durableInstructionIsOwnerWording({
      ownerText: input.capture.ownerTurn,
      instruction: input.instruction,
    })
  )
    return { status: "owner_wording" };
  const call = await runGovernedCaptureCall({
    context: input.context,
    call: {
      captureId: input.capture.captureId,
      runPrefix: "capturecheck",
      turnEventPrefix: "kchk",
      stage: INSTRUCTION_CROSS_CHECK_STAGE,
    },
    systemPrompt: durableInstructionCrossCheckInstruction,
    catalogEntries: input.catalogEntries,
    sourceRevision: input.sourceRevision,
    request: async () =>
      durableInstructionCrossCheckRequest({
        ownerText: input.capture.ownerTurn,
        precedingAgentTurn: input.capture.precedingAgentTurn,
        instruction: input.instruction,
      }),
  });
  if (call.status !== "assessed") return call;
  let verdict: ReturnType<typeof parseDurableInstructionCrossCheckResponse>;
  try {
    verdict = parseDurableInstructionCrossCheckResponse(call.value);
  } catch {
    return { status: "failed" };
  }
  return {
    status: verdict.verdict,
    reasonIds: verdict.reasonIds,
    tokens: call.usage?.totalTokens ?? 0,
  };
}
