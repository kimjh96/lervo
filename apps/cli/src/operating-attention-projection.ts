import type {
  CanonicalizationAttentionItemV1,
  KnowledgeLifecycleAttentionItemV1,
  OperatingAttentionItemV1,
  OperatingAttentionReportV1,
} from "@lervo/application-contract";
import {
  canonicalJson,
  sha256,
  type CanonicalizationCandidateInspection,
} from "@lervo/repository-knowledge";
import type { WorkstreamSnapshot } from "@lervo/schemas";

import type { TerminalLifecycleInspection } from "./terminal-hook-contract.js";

const MAXIMUM_ATTENTION_ITEMS = 256;

function canonicalizationItem(
  candidate: CanonicalizationCandidateInspection,
): CanonicalizationAttentionItemV1 | null {
  if (
    candidate.observedState !== "candidate" &&
    candidate.observedState !== "pending" &&
    candidate.observedState !== "stale"
  ) {
    return null;
  }
  return {
    schemaVersion: 1,
    kind: "canonicalization_review",
    itemId: candidate.candidateId,
    state: candidate.observedState,
    candidateId: candidate.candidateId,
    candidateHash: candidate.contentHash,
    sourcePaths: candidate.sourceBindings.map((binding) => binding.path).sort(),
    responsibilities: [
      ...new Set(candidate.sourceBindings.map((binding) => binding.responsibility)),
    ].sort(),
    recommendedRoots: [...candidate.recommendedRoots].sort(),
    outcomeKind: candidate.outcome?.kind ?? null,
    proposedTargetPaths:
      candidate.outcome?.kind === "canonical_update"
        ? candidate.outcome.targets.map((target) => target.path).sort()
        : candidate.outcome?.kind === "review_draft"
          ? candidate.outcome.drafts.map((draft) => draft.targetPath).sort()
          : [],
    hasProposedContent: candidate.outcome?.kind === "review_draft",
    createdAt: candidate.createdAt,
    actionOwner: candidate.observedState === "pending" ? "user" : "reviewer",
    requiresUserAction: candidate.observedState === "pending",
    blocking: candidate.observedState === "pending",
    instruction:
      candidate.observedState === "stale"
        ? `Inspect stale candidate ${candidate.candidateId}; it permits exact-hash rejection with ${candidate.contentHash} but not defer or promotion.`
        : candidate.observedState === "pending"
          ? `Run lervo knowledge canonicalization status ${candidate.candidateId} --json and present its bounded outcome and exact ${candidate.contentHash} review binding; apply no write or promotion without explicit authority.`
          : `Inspect candidate ${candidate.candidateId} and use exact hash ${candidate.contentHash} for defer, reject, or promotion review.`,
  };
}

function lifecycleOwner(
  issue: TerminalLifecycleInspection["issues"][number],
): Pick<KnowledgeLifecycleAttentionItemV1, "actionOwner" | "requiresUserAction"> {
  if (issue.code === "turn_approval_pending" || issue.code.includes("review_required")) {
    return { actionOwner: "user", requiresUserAction: true };
  }
  return { actionOwner: "agent", requiresUserAction: false };
}

function ordered(items: OperatingAttentionItemV1[]): OperatingAttentionItemV1[] {
  return items.sort((left, right) => {
    const user = Number(right.requiresUserAction) - Number(left.requiresUserAction);
    if (user !== 0) return user;
    const blocking = Number(right.blocking) - Number(left.blocking);
    if (blocking !== 0) return blocking;
    const kind = left.kind.localeCompare(right.kind);
    return kind === 0 ? left.itemId.localeCompare(right.itemId) : kind;
  });
}

export function createOperatingAttentionReport(input: {
  projectId: string;
  workstream: WorkstreamSnapshot | null;
  canonicalization: {
    coverage: OperatingAttentionReportV1["coverage"]["canonicalization"];
    candidates: CanonicalizationCandidateInspection[];
  };
  knowledgeLifecycle: {
    coverage: OperatingAttentionReportV1["coverage"]["knowledgeLifecycle"];
    issues: TerminalLifecycleInspection["issues"];
  };
  observedAt: Date;
}): OperatingAttentionReportV1 {
  const workstreamItems: OperatingAttentionItemV1[] =
    input.workstream === null
      ? []
      : [
          ...(input.workstream.pendingDecisions ?? []).map(
            (decision): OperatingAttentionItemV1 => ({
              schemaVersion: 1,
              kind: "workstream_decision",
              itemId: decision.decisionId,
              state: "pending",
              decisionId: decision.decisionId,
              question: decision.question,
              choices: decision.choices.map((choice) => ({ ...choice })),
              recommendedChoiceId: decision.recommendedChoiceId,
              actionOwner: "user",
              requiresUserAction: true,
              blocking: decision.blocking,
              instruction: `Resolve workstream decision ${decision.decisionId} through an authorized workstream update.`,
            }),
          ),
          ...(input.workstream.pendingApprovals ?? []).map(
            (approval): OperatingAttentionItemV1 => ({
              schemaVersion: 1,
              kind: "workstream_approval",
              itemId: approval.approvalId,
              state: "pending",
              approvalId: approval.approvalId,
              approvalKind: approval.kind,
              summary: approval.summary,
              bindingHash: approval.bindingHash,
              actionOwner: "user",
              requiresUserAction: true,
              blocking: approval.blocking,
              instruction: `Resolve workstream approval ${approval.approvalId} only against its exact binding hash.`,
            }),
          ),
          ...input.workstream.blockers.map((summary, blockerIndex): OperatingAttentionItemV1 => ({
            schemaVersion: 1,
            kind: "workstream_blocker",
            itemId: `workstream_blocker_${sha256(summary).slice("sha256:".length, "sha256:".length + 24)}`,
            state: "blocked",
            blockerIndex,
            summary,
            actionOwner: "unassigned",
            requiresUserAction: false,
            blocking: true,
            instruction:
              "Inspect the blocker against current repository evidence before assigning an action owner.",
          })),
        ];
  const candidateItems = input.canonicalization.candidates.flatMap((candidate) => {
    const item = canonicalizationItem(candidate);
    return item === null ? [] : [item];
  });
  const lifecycleItems: KnowledgeLifecycleAttentionItemV1[] =
    input.knowledgeLifecycle.coverage === "unavailable"
      ? []
      : input.knowledgeLifecycle.issues.map((issue) => ({
          schemaVersion: 1,
          kind: "knowledge_lifecycle",
          itemId: `knowledge_lifecycle_${sha256(canonicalJson(issue)).slice("sha256:".length, "sha256:".length + 24)}`,
          state: "action_required",
          issueCode: issue.code,
          detail: issue.detail ?? null,
          ...lifecycleOwner(issue),
          blocking: issue.code === "turn_approval_pending",
          instruction: issue.command,
        }));
  const allItems = ordered([
    ...new Map(
      [...workstreamItems, ...candidateItems, ...lifecycleItems].map((item) => [item.itemId, item]),
    ).values(),
  ]);
  const items = allItems.slice(0, MAXIMUM_ATTENTION_ITEMS);
  const digestInput = {
    projectId: input.projectId,
    workstream:
      input.workstream === null
        ? null
        : {
            workstreamId: input.workstream.workstreamId,
            revision: input.workstream.revision,
          },
    coverage: {
      workstream: input.workstream === null ? ("missing" as const) : ("current" as const),
      canonicalization: input.canonicalization.coverage,
      knowledgeLifecycle: input.knowledgeLifecycle.coverage,
    },
    items,
  };
  return {
    schemaVersion: 1,
    kind: "operating_attention.report",
    projectId: input.projectId,
    workstream: digestInput.workstream,
    observedAt: input.observedAt.toISOString(),
    reportDigest: sha256(canonicalJson(digestInput)),
    status:
      items.length === 0 &&
      input.canonicalization.coverage === "complete" &&
      input.knowledgeLifecycle.coverage !== "unavailable"
        ? "current"
        : "action_required",
    coverage: digestInput.coverage,
    summary: {
      totalCount: allItems.length,
      truncatedCount: allItems.length - items.length,
      blockingCount: allItems.filter((item) => item.blocking).length,
      userActionCount: allItems.filter((item) => item.requiresUserAction).length,
      staleCount: allItems.filter((item) => item.state === "stale").length,
    },
    items,
    limitations: [
      "This report is a read-only projection and grants no review, approval, write, provider, or external-effect authority.",
      "A prepared attention item does not prove that a provider or user received, understood, acknowledged, or acted on it.",
      "Unavailable source coverage is unknown, not current or empty.",
    ],
  };
}
