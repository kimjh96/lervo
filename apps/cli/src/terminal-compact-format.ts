import type { OperatingAttentionReportV1 } from "@lervo/application-contract";
import { canonicalJson, sha256, type WorkstreamFreshness } from "@lervo/repository-knowledge";
import type { WorkstreamSnapshot } from "@lervo/schemas";

import { isStaleWorkstreamItem, staleWorkstreamCountLine } from "./operating-attention-format.js";
import { capContextBytes, MAXIMUM_COMPACT_CONTEXT_BYTES } from "./terminal-context-budget.js";

const MAXIMUM_ITEM_BYTES = 360;
const MAXIMUM_DECISIONS = 3;

function bounded(value: string, maximumBytes = MAXIMUM_ITEM_BYTES): string {
  if (Buffer.byteLength(value) <= maximumBytes) return value;
  let result = "";
  for (const character of value) {
    if (Buffer.byteLength(`${result}${character}…`) > maximumBytes) break;
    result += character;
  }
  return `${result}…`;
}

export function formatCompactWorkstreamContext(
  snapshot: WorkstreamSnapshot,
  freshness: WorkstreamFreshness,
) {
  const decisions = snapshot.pendingDecisions ?? [];
  const headline = `Lervo workstream: ${bounded(snapshot.title, 200)} (revision ${snapshot.revision}).`;
  const context =
    freshness.status === "stale"
      ? [
          headline,
          `Its state is stale (${freshness.reasons.join(",")}); its next actions, blockers, decisions, and approvals are not current.`,
        ].join("\n")
      : [
          headline,
          ...(snapshot.nextActions[0] === undefined
            ? []
            : [`Next: ${bounded(snapshot.nextActions[0])}`]),
          ...(decisions.length === 0
            ? []
            : [
                `Pending user decisions: ${decisions.length}.`,
                ...decisions
                  .slice(0, MAXIMUM_DECISIONS)
                  .map(
                    (item) =>
                      `- ${item.decisionId}${item.blocking ? " [blocking]" : ""}: ${bounded(item.question, 240)}; recommended=${item.recommendedChoiceId ?? "none"}`,
                  ),
              ]),
        ].join("\n");
  return {
    workstreamId: snapshot.workstreamId,
    revision: snapshot.revision,
    snapshotHash: sha256(`${canonicalJson(snapshot)}\n`),
    scope: "prefix" as const,
    deliveredByteCount: Buffer.byteLength(context),
    context,
  };
}

/** Stale workstream entries: attention items plus next actions, which carry no attention item. */
export function staleWorkstreamEntryCount(
  attention: OperatingAttentionReportV1,
  snapshot: WorkstreamSnapshot | null,
  freshness: WorkstreamFreshness | null,
): number {
  if (snapshot === null || freshness?.status !== "stale") return 0;
  return attention.items.filter(isStaleWorkstreamItem).length + snapshot.nextActions.length;
}

export function formatCompactTerminalPreamble(input: {
  attention: OperatingAttentionReportV1;
  /** Synchronous declaration contract, used only while no background owner is running. */
  declarationInstruction: string;
  backgroundKnowledgeActive: boolean;
  workstreamPresent: boolean;
  staleWorkstreamEntryCount: number;
  /** The ADR-0463 freshness line, at most 200 bytes, or null when every count is zero. */
  documentFreshnessLine?: string | null;
  /** ADR-0466 capture and applied-owner-rule lines, each at most 600 bytes. */
  instructionCaptureLines?: readonly string[];
}): string {
  const blocking = input.attention.items
    .filter((item) => item.blocking && !isStaleWorkstreamItem(item))
    .slice(0, 5);
  return [
    'Lervo compact terminal context. Before changing repository bytes, run `lervo knowledge query "<purpose and paths>"` for applicable rules, as AGENTS.md requires.',
    ...(blocking.length === 0
      ? []
      : [
          `Blocking attention: ${blocking.map((item) => `${item.kind}:${item.itemId}${item.requiresUserAction ? " [user]" : ""}`).join("; ")}. Details: \`lervo application attention --json\`.`,
        ]),
    ...staleWorkstreamCountLine(input.staleWorkstreamEntryCount),
    ...(input.documentFreshnessLine === undefined || input.documentFreshnessLine === null
      ? []
      : [input.documentFreshnessLine]),
    ...(input.instructionCaptureLines ?? []),
    ...(input.backgroundKnowledgeActive
      ? [
          "Background knowledge convergence is active and owns canonicalization, normalization, and knowledge refresh; this turn needs no knowledge refresh or turn declaration.",
        ]
      : [input.declarationInstruction]),
    input.workstreamPresent
      ? "If this turn changes repository-authored bytes, record the next bounded revision with `lervo workstream update --actor agent --provider <current-provider> --patch <json> --apply-now`; the service sets revision, update time, and HEAD. Never ask the user to run bookkeeping."
      : "If this turn changes repository-authored bytes, create a bounded checkpoint with `lervo workstream start --actor agent --provider <current-provider> --stdin --apply-now`; never ask the user to run bookkeeping.",
  ].join("\n");
}

/**
 * The whole compact context fits one hard byte budget. The preamble keeps priority; the workstream
 * section receives the remaining bytes, and its delivered count reflects any truncation.
 */
export function assembleCompactTerminalContext(
  preamble: string,
  workstream: ReturnType<typeof formatCompactWorkstreamContext> | null,
): {
  additionalContext: string;
  workstream: ReturnType<typeof formatCompactWorkstreamContext> | null;
} {
  const cappedPreamble = capContextBytes(preamble, MAXIMUM_COMPACT_CONTEXT_BYTES);
  const separator = "\n\n";
  const remaining =
    MAXIMUM_COMPACT_CONTEXT_BYTES -
    Buffer.byteLength(cappedPreamble) -
    Buffer.byteLength(separator);
  if (workstream === null || remaining <= 0 || cappedPreamble !== preamble)
    return { additionalContext: cappedPreamble, workstream: null };
  const context = capContextBytes(workstream.context, remaining);
  const delivered = { ...workstream, context, deliveredByteCount: Buffer.byteLength(context) };
  return { additionalContext: `${cappedPreamble}${separator}${context}`, workstream: delivered };
}
