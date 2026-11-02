import type {
  CanonicalizationAttentionItemV1,
  KnowledgeLifecycleAttentionItemV1,
  OperatingAttentionItemV1,
  OperatingAttentionReportV1,
  RepositoryReplicaDivergenceAttentionItemV1,
} from "@lervo/application-contract";
import {
  canonicalJson,
  sha256,
  STALE_WORKSTREAM_INSTRUCTION,
  workstreamApprovalConsequence,
  type CanonicalizationCandidateInspection,
  type WorkstreamFreshness,
} from "@lervo/repository-knowledge";
import type { WorkstreamSnapshot } from "@lervo/schemas";
import type { RepositoryReplicaOpenDivergence } from "@lervo/sync";

import {
  documentFreshnessAttentionItems,
  type DocumentFreshnessAttentionInput,
} from "./document-freshness-attention.js";
import {
  instructionCaptureAttentionItems,
  type InstructionCaptureAttentionInput,
} from "./instruction-capture-attention.js";
import {
  knowledgeConvergenceAttentionItems,
  type KnowledgeConvergenceAttentionInput,
} from "./knowledge-convergence-attention.js";
import type { TerminalLifecycleInspection } from "./terminal-hook-contract.js";
import { attributeOperatingAttention } from "./operating-attention-ownership.js";

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

/**
 * ADR-0561: a reviewed knowledge lifecycle plan (bootstrap, layout, structural, bridge) is applied
 * by Lervo after an independent cross-check, so it is agent work. Only the terminal integration
 * approval still waits for the owner until its own replacement lands.
 */
function lifecycleOwner(
  issue: TerminalLifecycleInspection["issues"][number],
): Pick<KnowledgeLifecycleAttentionItemV1, "actionOwner" | "requiresUserAction"> {
  if (issue.code === "turn_approval_pending")
    return { actionOwner: "user", requiresUserAction: true };
  return { actionOwner: "agent", requiresUserAction: false };
}

function replicaDivergenceItem(
  divergence: RepositoryReplicaOpenDivergence,
): RepositoryReplicaDivergenceAttentionItemV1 {
  return {
    schemaVersion: 1,
    kind: "repository_replica_divergence",
    itemId: `repository_replica_divergence_${divergence.divergenceId.slice("sha256:".length, "sha256:".length + 24)}`,
    state: "action_required",
    replicaId: divergence.replicaId,
    divergenceId: divergence.divergenceId,
    reason: divergence.reason,
    conflictPathCount: divergence.conflictPathCount,
    conflictPaths: [...divergence.conflictPaths],
    openedAt: divergence.openedAt,
    actionOwner: "user",
    requiresUserAction: true,
    blocking: false,
    instruction:
      divergence.reason === "no_common_history"
        ? `Replica ${divergence.replicaId} has no common history with its peer; choose which host's repository to keep and re-seed the other before replication resumes.`
        : `Make both hosts agree on the conflicting paths, or on the coordinator host run lervo-node repository-replica reconcile --config <coordinator-config> --replica ${divergence.replicaId} --prefer local|peer; the reconciling cycle records repository.replica.reconciled.`,
  };
}

const STALE_INSTRUCTION = `${STALE_WORKSTREAM_INSTRUCTION} Inspect it with lervo workstream current.`;

/**
 * Current workstream items carry the snapshot's authority framing. Stale items are owned by the
 * agent for re-verification: never blocking, never requiring user action, never a directive.
 */
function workstreamAttentionItems(
  workstream: WorkstreamSnapshot,
  stale: boolean,
): OperatingAttentionItemV1[] {
  return [
    ...(workstream.pendingDecisions ?? []).map((decision): OperatingAttentionItemV1 => ({
      schemaVersion: 1,
      kind: "workstream_decision",
      itemId: decision.decisionId,
      state: stale ? "stale" : "pending",
      consequence: "unclassified",
      decisionId: decision.decisionId,
      question: decision.question,
      choices: decision.choices.map((choice) => ({ ...choice })),
      recommendedChoiceId: decision.recommendedChoiceId,
      actionOwner: stale ? "agent" : "user",
      requiresUserAction: !stale,
      blocking: !stale && decision.blocking,
      instruction: stale
        ? STALE_INSTRUCTION
        : `Resolve workstream decision ${decision.decisionId} through an authorized workstream update.`,
    })),
    ...(workstream.pendingApprovals ?? []).map((approval): OperatingAttentionItemV1 => ({
      schemaVersion: 1,
      kind: "workstream_approval",
      itemId: approval.approvalId,
      state: stale ? "stale" : "pending",
      consequence: workstreamApprovalConsequence(approval.kind),
      approvalId: approval.approvalId,
      approvalKind: approval.kind,
      summary: approval.summary,
      bindingHash: approval.bindingHash,
      actionOwner: stale ? "agent" : "user",
      requiresUserAction: !stale,
      blocking: !stale && approval.blocking,
      instruction: stale
        ? STALE_INSTRUCTION
        : `Resolve workstream approval ${approval.approvalId} only against its exact binding hash.`,
    })),
    ...workstream.blockers.map((summary, blockerIndex): OperatingAttentionItemV1 => ({
      schemaVersion: 1,
      kind: "workstream_blocker",
      itemId: `workstream_blocker_${sha256(summary).slice("sha256:".length, "sha256:".length + 24)}`,
      state: stale ? "stale" : "blocked",
      blockerIndex,
      summary,
      actionOwner: stale ? "agent" : "unassigned",
      requiresUserAction: false,
      blocking: !stale,
      instruction: stale
        ? STALE_INSTRUCTION
        : "Inspect the blocker against current repository evidence before assigning an action owner.",
    })),
  ];
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
  /** Freshness of the current workstream; null only when no workstream exists. */
  workstreamFreshness: WorkstreamFreshness | null;
  canonicalization: {
    coverage: OperatingAttentionReportV1["coverage"]["canonicalization"];
    candidates: CanonicalizationCandidateInspection[];
  };
  knowledgeLifecycle: {
    coverage: OperatingAttentionReportV1["coverage"]["knowledgeLifecycle"];
    issues: TerminalLifecycleInspection["issues"];
  };
  /** The open divergence the local replica receipt projects, when replication is configured. */
  repositoryReplicaDivergence?: RepositoryReplicaOpenDivergence | null;
  /** ADR-0463 freshness candidates, applies, and the blocked window; null when unreadable. */
  documentFreshness?: DocumentFreshnessAttentionInput | null;
  /** ADR-0467 instruction candidates and held owner decisions; null when unreadable. */
  instructionCapture?: InstructionCaptureAttentionInput | null;
  /** ADR-0466 ownership and publication state; null when unreadable. */
  knowledgeConvergence?: KnowledgeConvergenceAttentionInput | null;
  workstreamCoverage?: OperatingAttentionReportV1["coverage"]["workstream"];
  health?: OperatingAttentionReportV1["health"];
  observedAt: Date;
}): OperatingAttentionReportV1 {
  const workstreamItems =
    input.workstream === null
      ? []
      : workstreamAttentionItems(input.workstream, input.workstreamFreshness?.status === "stale");
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
  const replicaItems =
    input.repositoryReplicaDivergence === undefined || input.repositoryReplicaDivergence === null
      ? []
      : [replicaDivergenceItem(input.repositoryReplicaDivergence)];
  const allItems = ordered([
    ...new Map(
      [
        ...workstreamItems,
        ...candidateItems,
        ...lifecycleItems,
        ...replicaItems,
        ...(input.documentFreshness === undefined || input.documentFreshness === null
          ? []
          : documentFreshnessAttentionItems(input.documentFreshness)),
        ...(input.instructionCapture === undefined || input.instructionCapture === null
          ? []
          : instructionCaptureAttentionItems(input.instructionCapture)),
        ...(input.knowledgeConvergence === undefined || input.knowledgeConvergence === null
          ? []
          : knowledgeConvergenceAttentionItems(input.knowledgeConvergence)),
      ].map((item) => [item.itemId, attributeOperatingAttention(item, input.observedAt)]),
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
      workstream: input.workstreamCoverage ?? (input.workstream === null ? "missing" : "current"),
      documentFreshness:
        input.documentFreshness == null ? ("unavailable" as const) : ("complete" as const),
      instructionCapture:
        input.instructionCapture == null ? ("unavailable" as const) : ("complete" as const),
      knowledgeConvergence:
        input.knowledgeConvergence == null ? ("unavailable" as const) : ("complete" as const),
      canonicalization: input.canonicalization.coverage,
      knowledgeLifecycle: input.knowledgeLifecycle.coverage,
    },
    items,
    ...(input.health === undefined ? {} : { health: input.health }),
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
      input.knowledgeLifecycle.coverage !== "unavailable" &&
      (input.health === undefined ||
        Object.values(input.health.measures).every(
          (measure) => measure.status === "within_target" && measure.coverage === "complete",
        ))
        ? "current"
        : "action_required",
    coverage: digestInput.coverage,
    summary: {
      totalCount: allItems.length,
      truncatedCount: allItems.length - items.length,
      blockingCount: allItems.filter((item) => item.blocking).length,
      userActionCount: allItems.filter((item) => item.requiresUserAction).length,
      staleCount: allItems.filter((item) => item.state === "stale").length,
      byKind: Object.fromEntries(
        [...new Set(allItems.map((item) => item.kind))].map((kind) => {
          const group = allItems.filter((item) => item.kind === kind);
          return [
            kind,
            {
              totalCount: group.length,
              userActionCount: group.filter((item) => item.requiresUserAction).length,
            },
          ];
        }),
      ),
    },
    items,
    limitations: [
      "This report is a read-only projection and grants no review, approval, write, provider, or external-effect authority.",
      "A prepared attention item does not prove that a provider or user received, understood, acknowledged, or acted on it.",
      "Unavailable source coverage is unknown, not current or empty.",
    ],
    ...(input.health === undefined ? {} : { health: input.health }),
  };
}
