import type { TerminalWorkspaceBinding } from "./terminal-workspace-contract.js";
import type { OperatingAttentionReportV1 } from "@lervo/application-contract";
import { canonicalJson, sha256, type WorkstreamFreshness } from "@lervo/repository-knowledge";
import type { TerminalHookFailureReason, WorkstreamSnapshot } from "@lervo/schemas";

import { isStaleWorkstreamItem, staleWorkstreamCountLine } from "./operating-attention-format.js";
import { capContextBytes, MAXIMUM_COMPACT_CONTEXT_BYTES } from "./terminal-context-budget.js";
import { terminalPublicationInstruction } from "./terminal-publication-instruction.js";
import { mergeCurrentOwnerAttention } from "./repository-health-owner-review.js";
import { formatRepositoryHealth } from "./repository-health-format.js";
import { unknownRepositoryHealth } from "./repository-health-reader.js";

export const TERMINAL_AGENTS_POINTER =
  'Lervo compact terminal context. Before changing repository bytes, run `lervo knowledge query "<purpose and paths>"` for applicable rules, as AGENTS.md requires.';

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

export function formatTerminalWorkspaceContext(binding: TerminalWorkspaceBinding | null): string[] {
  return binding?.executionKind === "worker"
    ? [
        `This direct provider turn is ${binding.attachmentDisposition ?? "attached"} on worker workspace ${binding.workspaceId} generation ${binding.workspaceGeneration}; provider execution remains unmanaged.`,
        "Change only assignment-scoped paths. Worker Stop rechecks workspace isolation and records a checkpoint. It does not advance the repository-wide workstream or repair knowledge movement owned by another workspace.",
      ]
    : [];
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
                `Pending decisions (principal proxy): ${decisions.length}.`,
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
  publicationLanguage: string;
  attention: OperatingAttentionReportV1;
  /** Synchronous declaration contract, used only while no background owner is running. */
  declarationInstruction: string;
  backgroundKnowledgeActive: boolean;
  workstreamPresent: boolean;
  staleWorkstreamEntryCount: number;
  /** The ADR-0463 freshness line, at most 200 bytes, or null when every count is zero. */
  documentFreshnessLine?: string | null;
  /** ADR-0467 capture and applied-owner-rule lines, each at most 600 bytes. */
  instructionCaptureLines?: readonly string[];
  /** ADR-0535 cached Know/Find health; empty when every measure is within target. */
  healthSection?: string;
  /** The current snapshot, so a projection from before the latest change is labeled as such. */
  repositoryRevision?: string;
  workspaceBinding?: TerminalWorkspaceBinding | null;
}): string {
  const now = new Date(input.attention.observedAt);
  const health =
    input.attention.health ??
    (input.attention.items.some((item) => item.requiresUserAction)
      ? unknownRepositoryHealth(`sha256:${"0".repeat(64)}`, now, "projection_missing_or_unreadable")
      : null);
  const healthSection =
    health === null
      ? input.healthSection
      : formatRepositoryHealth(
          mergeCurrentOwnerAttention(health, input.attention),
          now,
          input.repositoryRevision,
        );
  const blocking = input.attention.items
    .filter((item) => item.blocking && !item.requiresUserAction && !isStaleWorkstreamItem(item))
    .slice(0, 5);
  return [
    TERMINAL_AGENTS_POINTER,
    terminalPublicationInstruction(input.publicationLanguage),
    ...formatTerminalWorkspaceContext(input.workspaceBinding ?? null),
    ...(blocking.length === 0
      ? []
      : [
          `Blocking attention: ${blocking.map((item) => `${item.kind}:${item.itemId}${item.requiresUserAction ? " [user]" : ""}`).join("; ")}. Details: \`lervo application attention --json\`.`,
        ]),
    ...staleWorkstreamCountLine(input.staleWorkstreamEntryCount),
    ...(healthSection ? [healthSection] : []),
    ...(input.documentFreshnessLine === undefined || input.documentFreshnessLine === null
      ? []
      : [input.documentFreshnessLine]),
    ...(input.instructionCaptureLines ?? []),
    ...(input.backgroundKnowledgeActive
      ? [
          "Background knowledge convergence is active and owns canonicalization, normalization, and knowledge refresh; this turn needs no knowledge refresh or turn declaration.",
        ]
      : [input.declarationInstruction]),
    input.workspaceBinding?.executionKind === "worker"
      ? "Worker completion uses its assignment checkpoint; do not advance another workspace's lifecycle."
      : input.workstreamPresent
        ? "If this turn changes repository-authored bytes, record the next bounded revision with `lervo workstream update --actor agent --provider <current-provider> --patch <json> --apply-now`; the service sets revision, update time, and HEAD. Never ask the user to run bookkeeping."
        : "No workstream continues the checked-out branch. If this turn changes repository-authored bytes, start this branch's workstream with `lervo workstream start --actor agent --provider <current-provider> --stdin --apply-now`; other branches keep their own. Never ask the user to run bookkeeping.",
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
  const context = wholeWorkstreamLines(workstream.context, remaining);
  if (context === null) return { additionalContext: cappedPreamble, workstream: null };
  const delivered = { ...workstream, context, deliveredByteCount: Buffer.byteLength(context) };
  return { additionalContext: `${cappedPreamble}${separator}${context}`, workstream: delivered };
}

const WORKSTREAM_OMITTED = "Lervo workstream: omitted for space; run `lervo workstream current`.";

/**
 * Whole lines in order, so a crowded turn never receives half a sentence. When a later line does
 * not fit, the last kept line becomes a pointer; when none fits, the pointer alone, or nothing.
 */
function wholeWorkstreamLines(context: string, maximumBytes: number): string | null {
  if (Buffer.byteLength(context) <= maximumBytes) return context;
  const lines = context.split("\n");
  const pointer = `\n${WORKSTREAM_OMITTED}`;
  const kept: string[] = [];
  for (const line of lines) {
    if (Buffer.byteLength([...kept, line].join("\n") + pointer) > maximumBytes) break;
    kept.push(line);
  }
  if (kept.length > 0) return `${kept.join("\n")}${pointer}`;
  return Buffer.byteLength(WORKSTREAM_OMITTED) <= maximumBytes ? WORKSTREAM_OMITTED : null;
}

export function formatDegradedTerminalContext(
  lines: string[],
  reason: TerminalHookFailureReason,
  workspaceBinding: TerminalWorkspaceBinding | null = null,
): string {
  // Reserve the notice before optional clauses so even a crowded preamble names the failure.
  const skipped =
    reason.startsWith("repository_snapshot_") || reason === "git_ignored_paths_unavailable"
      ? "repository state checks were skipped this turn."
      : reason === "knowledge_inspection_failed"
        ? "knowledge checks were skipped this turn."
        : "full context preparation or recording did not finish this turn.";
  const notice = `Lervo context degraded (${reason}); ${skipped}`;
  const optional =
    workspaceBinding?.executionKind === "worker"
      ? lines
          .slice(1)
          .filter((line) => !line.startsWith("If this turn changes repository-authored bytes"))
      : lines.slice(1);
  return capContextBytes(
    [
      lines[0] ?? TERMINAL_AGENTS_POINTER,
      notice,
      ...formatTerminalWorkspaceContext(workspaceBinding),
      ...optional,
    ].join("\n\n"),
    MAXIMUM_COMPACT_CONTEXT_BYTES,
  );
}
