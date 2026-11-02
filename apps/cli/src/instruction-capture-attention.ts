import type {
  CapturedDecisionAttentionItemV1,
  DurableInstructionCandidateAttentionItemV1,
  InstructionCaptureBlockedAttentionItemV1,
  OperatingAttentionItemV1,
} from "@lervo/application-contract";
import {
  listDurableInstructionCandidates,
  listGeneratedDurableInstructions,
  type DurableInstructionCandidateInspection,
  type GeneratedDurableInstruction,
} from "@lervo/repository-knowledge";
import {
  instructionCandidateApplyAuthority,
  readInstructionCaptureState,
  type HeldCapture,
} from "@lervo/repository-knowledge-runtime";

/** Rebuildable capture state the attention projection and compact prompt read (ADR-0467). */
export interface InstructionCaptureAttentionInput {
  candidates: readonly DurableInstructionCandidateInspection[];
  held: readonly HeldCapture[];
  applied: { rules: readonly GeneratedDurableInstruction[]; totalCount: number };
  /**
   * Where candidates are applied when this Hub-coordinated host does not own convergence:
   * the owner's label, or null for an unnamed owner. Undefined when this host may apply.
   */
  applyElsewhere?: { holderLabel: string | null };
  /** Owner turns this host may not assess because it has no background-work authority. */
  authorityBlocked?: { since: string; queuedCount: number } | null;
}

const MAXIMUM_LINE_BYTES = 600;

function boundedLine(value: string): string {
  if (Buffer.byteLength(value) <= MAXIMUM_LINE_BYTES) return value;
  let end = value.length;
  while (Buffer.byteLength(`${value.slice(0, end)}…`) > MAXIMUM_LINE_BYTES) end -= 1;
  return `${value.slice(0, end)}…`;
}

function ownerHost(input: InstructionCaptureAttentionInput): string {
  return input.applyElsewhere?.holderLabel === null || input.applyElsewhere === undefined
    ? "the convergence owner host"
    : `the convergence owner host (${input.applyElsewhere.holderLabel})`;
}

function candidateItem(
  candidate: DurableInstructionCandidateInspection,
  input: InstructionCaptureAttentionInput,
): DurableInstructionCandidateAttentionItemV1 {
  return {
    schemaVersion: 1,
    kind: "durable_instruction_candidate",
    itemId: `durable_instruction_${candidate.candidateId}`,
    state: "pending_apply",
    candidateId: candidate.candidateId,
    candidateHash: candidate.candidateHash,
    captureSource: candidate.captureSource ?? "explicit_intake",
    title: candidate.instruction.title ?? candidate.ruleId,
    targetPath: candidate.targetPath,
    createdAt: candidate.createdAt,
    actionOwner: "host resident",
    requiresUserAction: false,
    blocking: false,
    instruction:
      input.applyElsewhere === undefined
        ? `The knowledge resident applies this stored owner rule in its next cycle; inspect it with lervo knowledge instruction status ${candidate.candidateId}.`
        : `${ownerHost(input)} applies this stored owner rule after its next Hub exchange; inspect it with lervo knowledge instruction status ${candidate.candidateId}.`,
  };
}

function heldItem(entry: HeldCapture): CapturedDecisionAttentionItemV1 {
  const heldKind = entry.kind === "decision" ? "decision" : "cross_check_disagreement";
  return {
    schemaVersion: 1,
    kind: "captured_decision",
    itemId: `captured_decision_${entry.captureId}`,
    state: "lervo_debt",
    heldKind,
    captureId: entry.captureId,
    captureSource: entry.source,
    title: entry.title,
    capturedAt: entry.capturedAt,
    actionOwner: "agent",
    requiresUserAction: false,
    blocking: false,
    instruction:
      heldKind === "decision"
        ? `Lervo debt: record this owner decision in the canonical documents, then clear it with lervo knowledge instruction capture --dismiss ${entry.captureId}.`
        : `Lervo debt: the independent cross-check rejected this captured rule, so it was not stored. A later owner turn that states it again is captured again; clear it with lervo knowledge instruction capture --dismiss ${entry.captureId}.`,
  };
}

function blockedItem(blocked: {
  since: string;
  queuedCount: number;
}): InstructionCaptureBlockedAttentionItemV1 {
  return {
    schemaVersion: 1,
    kind: "instruction_capture_blocked",
    itemId: "instruction_capture_blocked_knowledge_authority_unavailable",
    state: "lervo_debt",
    reasonCode: "knowledge_authority_unavailable",
    queuedCount: blocked.queuedCount,
    since: blocked.since,
    actionOwner: "host resident",
    requiresUserAction: false,
    blocking: false,
    instruction:
      "Lervo debt: owner turns on this host wait for assessment because it has no active knowledge convergence delegation for its provider. Explicitly submitted owner rules stay queued until assessed; other queued turns expire after 24 hours.",
  };
}

/** Maps candidates, held items, and a missing delegation to the ADR-0467 attention kinds. */
export function instructionCaptureAttentionItems(
  input: InstructionCaptureAttentionInput,
): OperatingAttentionItemV1[] {
  return [
    ...input.candidates.map((candidate) => candidateItem(candidate, input)),
    ...input.held.map(heldItem),
    ...(input.authorityBlocked === undefined || input.authorityBlocked === null
      ? []
      : [blockedItem(input.authorityBlocked)]),
  ];
}

/**
 * The compact prompt lines: pending owner-rule work, and the applied owner rules every provider
 * must follow. Titles are normalized rule titles from reviewed files, never prompt text.
 */
export function instructionCaptureCompactLines(
  input: InstructionCaptureAttentionInput,
  includeAppliedRules = true,
): string[] {
  const lines: string[] = [];
  if (input.authorityBlocked !== undefined && input.authorityBlocked !== null)
    lines.push(
      `Instruction capture (Lervo debt, no owner action): ${input.authorityBlocked.queuedCount} owner turn${input.authorityBlocked.queuedCount === 1 ? "" : "s"} wait for assessment on this host because it has no knowledge convergence delegation.`,
    );
  const captured = input.candidates.filter((candidate) => candidate.captureSource !== undefined);
  if (input.candidates.length > 0 || input.held.length > 0) {
    const where =
      input.applyElsewhere === undefined
        ? "automatic apply"
        : `automatic apply on ${ownerHost(input)}`;
    const parts = [
      ...(input.candidates.length === 0
        ? []
        : [
            `${input.candidates.length === 1 ? "1 instruction candidate awaits" : `${input.candidates.length} instruction candidates await`} ${where} (${captured.length} captured from owner turns): ${input.candidates
              .slice(0, 3)
              .map((candidate) => candidate.instruction.title ?? candidate.ruleId)
              .join("; ")}`,
          ]),
      ...(input.held.length === 0
        ? []
        : [
            `${input.held.length} held decision${input.held.length === 1 ? "" : "s"} or rejected rule${input.held.length === 1 ? "" : "s"} as Lervo debt`,
          ]),
    ];
    lines.push(
      boundedLine(
        `Instruction capture: ${parts.join("; ")}. Details: lervo knowledge instruction status and lervo knowledge instruction capture.`,
      ),
    );
  }
  if (includeAppliedRules && input.applied.rules.length > 0) {
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
  const [candidates, state, applied, authority] = await Promise.all([
    listDurableInstructionCandidates(root).catch(() => []),
    readInstructionCaptureState(root).catch(() => null),
    listGeneratedDurableInstructions(root).catch(() => ({ rules: [], totalCount: 0 })),
    instructionCandidateApplyAuthority(root).catch(() => ({ status: "single_host" as const })),
  ]);
  return {
    candidates,
    held: state?.held ?? [],
    applied,
    ...(authority.status === "owner_elsewhere"
      ? { applyElsewhere: { holderLabel: authority.holderLabel } }
      : {}),
    authorityBlocked: state?.authorityBlocked ?? null,
  };
}
