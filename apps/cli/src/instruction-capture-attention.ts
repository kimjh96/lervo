import type {
  CapturedDecisionAttentionItemV1,
  DurableInstructionCandidateAttentionItemV1,
  OperatingAttentionItemV1,
} from "@lervo/application-contract";
import {
  listDurableInstructionCandidates,
  listGeneratedDurableInstructions,
  type DurableInstructionCandidateInspection,
  type GeneratedDurableInstruction,
} from "@lervo/repository-knowledge";
import { readInstructionCaptureState, type HeldCapture } from "@lervo/repository-knowledge-runtime";

/** Rebuildable capture state the attention projection and compact prompt read (ADR-0466). */
export interface InstructionCaptureAttentionInput {
  candidates: readonly DurableInstructionCandidateInspection[];
  held: readonly HeldCapture[];
  applied: { rules: readonly GeneratedDurableInstruction[]; totalCount: number };
}

const MAXIMUM_LINE_BYTES = 600;

function boundedLine(value: string): string {
  if (Buffer.byteLength(value) <= MAXIMUM_LINE_BYTES) return value;
  let end = value.length;
  while (Buffer.byteLength(`${value.slice(0, end)}…`) > MAXIMUM_LINE_BYTES) end -= 1;
  return `${value.slice(0, end)}…`;
}

function candidateItem(
  candidate: DurableInstructionCandidateInspection,
): DurableInstructionCandidateAttentionItemV1 {
  return {
    schemaVersion: 1,
    kind: "durable_instruction_candidate",
    itemId: `durable_instruction_${candidate.candidateId}`,
    state: "waiting_authority",
    candidateId: candidate.candidateId,
    candidateHash: candidate.candidateHash,
    captureSource: candidate.captureSource ?? "explicit_intake",
    title: candidate.instruction.title ?? candidate.ruleId,
    targetPath: candidate.targetPath,
    actionOwner: "user",
    requiresUserAction: true,
    blocking: false,
    instruction: `Review the exact rule with lervo knowledge instruction status ${candidate.candidateId}; apply with lervo knowledge instruction review ${candidate.candidateId} --decision apply --reviewer <id> --approval ${candidate.candidateHash}, or reject it.`,
  };
}

function heldItem(entry: HeldCapture): CapturedDecisionAttentionItemV1 {
  return {
    schemaVersion: 1,
    kind: "captured_decision",
    itemId: `captured_decision_${entry.captureId}`,
    state: "action_required",
    captureId: entry.captureId,
    captureSource: entry.source,
    title: entry.title,
    capturedAt: entry.capturedAt,
    actionOwner: "user",
    requiresUserAction: true,
    blocking: false,
    instruction:
      entry.kind === "decision"
        ? `Record this decision in the canonical documents, then dismiss it with lervo knowledge instruction capture --dismiss ${entry.captureId}.`
        : `Confirm the rule's scope with lervo knowledge instruction intake, then dismiss it with lervo knowledge instruction capture --dismiss ${entry.captureId}.`,
  };
}

/** Maps captured candidates and held items to the two ADR-0466 attention kinds. */
export function instructionCaptureAttentionItems(
  input: InstructionCaptureAttentionInput,
): OperatingAttentionItemV1[] {
  return [...input.candidates.map(candidateItem), ...input.held.map(heldItem)];
}

/**
 * The compact prompt lines: what waits for the owner, and the applied owner rules every provider
 * must follow. Titles are normalized rule titles from reviewed files, never prompt text.
 */
export function instructionCaptureCompactLines(input: InstructionCaptureAttentionInput): string[] {
  const lines: string[] = [];
  const captured = input.candidates.filter((candidate) => candidate.captureSource !== undefined);
  if (input.candidates.length > 0 || input.held.length > 0) {
    const parts = [
      ...(input.candidates.length === 0
        ? []
        : [
            `${input.candidates.length === 1 ? "1 instruction candidate awaits" : `${input.candidates.length} instruction candidates await`} review (${captured.length} captured from owner turns): ${input.candidates
              .slice(0, 3)
              .map((candidate) => candidate.instruction.title ?? candidate.ruleId)
              .join("; ")}`,
          ]),
      ...(input.held.length === 0
        ? []
        : [
            `${input.held.length} held owner decision or rule${input.held.length === 1 ? "" : "s"}`,
          ]),
    ];
    lines.push(
      boundedLine(
        `Instruction capture: ${parts.join("; ")}. Tell the owner; details: lervo knowledge instruction status and lervo knowledge instruction capture.`,
      ),
    );
  }
  if (input.applied.rules.length > 0) {
    const more = input.applied.totalCount - input.applied.rules.length;
    lines.push(
      boundedLine(
        `Applied owner rules (follow them; full text in docs/instructions/generated/): ${input.applied.rules
          .map((rule) => rule.title)
          .join("; ")}${more > 0 ? `; +${more} more` : ""}.`,
      ),
    );
  }
  return lines;
}

/** Reads the capture surfaces; an unreadable source contributes nothing rather than failing. */
export async function readInstructionCaptureAttention(
  root: string,
): Promise<InstructionCaptureAttentionInput> {
  const [candidates, state, applied] = await Promise.all([
    listDurableInstructionCandidates(root).catch(() => []),
    readInstructionCaptureState(root).catch(() => null),
    listGeneratedDurableInstructions(root).catch(() => ({ rules: [], totalCount: 0 })),
  ]);
  return { candidates, held: state?.held ?? [], applied };
}
