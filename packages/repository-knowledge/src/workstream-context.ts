import type { WorkstreamSnapshot } from "@lervo/schemas";

import { canonicalJson, sha256 } from "./integrity.js";
import {
  STALE_WORKSTREAM_INSTRUCTION,
  workstreamApprovalConsequence,
  type WorkstreamFreshness,
} from "./workstream-freshness.js";

function freshnessLine(freshness: WorkstreamFreshness): string {
  if (freshness.status === "current") return "Freshness: current.";
  const behind =
    freshness.commitsBehind === null ? "" : `; ${freshness.commitsBehind} commits behind HEAD`;
  return `Freshness: stale (${freshness.reasons.join(",")}; recorded ${freshness.ageHours}h ago${behind}).`;
}

function currentItems(snapshot: WorkstreamSnapshot): string[] {
  const pendingDecisions = snapshot.pendingDecisions ?? [];
  const pendingApprovals = snapshot.pendingApprovals ?? [];
  return [
    ...(snapshot.nextActions.length === 0
      ? []
      : ["Next actions:", ...snapshot.nextActions.map((item, index) => `${index + 1}. ${item}`)]),
    ...(snapshot.blockers.length === 0
      ? []
      : ["Blockers:", ...snapshot.blockers.map((item) => `- ${item}`)]),
    ...(snapshot.notes.length === 0
      ? []
      : ["Current facts:", ...snapshot.notes.map((item) => `- ${item}`)]),
    ...(snapshot.references.length === 0
      ? []
      : ["References:", ...snapshot.references.map((item) => `- ${item.label}: ${item.path}`)]),
    ...(pendingDecisions.length === 0
      ? []
      : [
          "Pending decisions (the principal proxy settles them within the operating mandate):",
          ...pendingDecisions.map(
            (item) =>
              `- ${item.decisionId}${item.blocking ? " [blocking]" : ""}: ${item.question}; choices=${item.choices.map((choice) => `${choice.choiceId}:${choice.label}`).join(", ")}; recommended=${item.recommendedChoiceId ?? "none"}`,
          ),
        ]),
    ...(pendingApprovals.length === 0
      ? []
      : [
          "Recorded approvals (Lervo debt: cross-check, make reversible, apply, and report each; never ask the owner):",
          ...pendingApprovals.map(
            (item) =>
              `- ${item.approvalId}${item.blocking ? " [blocking]" : ""}: ${item.kind}; ${item.summary}; binding=${item.bindingHash}`,
          ),
        ]),
  ];
}

/**
 * Stale items stay inspectable but lose their authority framing: no blocking marker and no
 * directive. Approvals and decisions are consequential, so their question or summary text is
 * withheld; only coordinates remain for re-verification.
 */
function staleItems(snapshot: WorkstreamSnapshot): string[] {
  const pendingDecisions = snapshot.pendingDecisions ?? [];
  const pendingApprovals = snapshot.pendingApprovals ?? [];
  const items = [
    ...snapshot.nextActions.map((item) => `- next action: ${item}`),
    ...snapshot.blockers.map((item) => `- blocker: ${item}`),
    ...pendingDecisions.map(
      (item) => `- decision ${item.decisionId}: text withheld (consequence unclassified)`,
    ),
    ...pendingApprovals.map(
      (item) =>
        `- approval ${item.approvalId}: ${item.kind}; text withheld (consequence ${workstreamApprovalConsequence(item.kind)}); binding=${item.bindingHash}`,
    ),
  ];
  return [
    ...(items.length === 0
      ? []
      : [`Stale workstream items. ${STALE_WORKSTREAM_INSTRUCTION}`, ...items]),
    ...(snapshot.notes.length === 0
      ? []
      : ["Recorded facts (stale):", ...snapshot.notes.map((item) => `- ${item}`)]),
    ...(snapshot.references.length === 0
      ? []
      : ["References:", ...snapshot.references.map((item) => `- ${item.label}: ${item.path}`)]),
  ];
}

export function formatWorkstreamContext(
  snapshot: WorkstreamSnapshot,
  freshness: WorkstreamFreshness | null = null,
): string {
  const lines = [
    "## Lervo current workstream",
    `workstreamId: ${snapshot.workstreamId}; revision: ${snapshot.revision}; status: ${snapshot.status}; snapshotHash: ${sha256(`${canonicalJson(snapshot)}\n`)}`,
    ...(freshness === null ? [] : [freshnessLine(freshness)]),
    `Title: ${snapshot.title}`,
    `Objective: ${snapshot.objective}`,
    ...(freshness?.status === "stale" ? staleItems(snapshot) : currentItems(snapshot)),
    ...((snapshot.droppedNoteCount ?? 0) === 0
      ? []
      : [`Older notes dropped by retention: ${snapshot.droppedNoteCount}.`]),
    "This is mutable continuation state, not a long-term architecture contract. Promote durable decisions to canonical repository documentation.",
    "Treat a natural-language user reply to a pending item as input to resolve, apply, remove, and canonically record that item when authorized. Never require the user to type a Lervo bookkeeping command.",
    "Before completing a repository-changing direct provider terminal turn, record the next bounded revision with `lervo workstream update --actor agent --provider <current-provider> --patch <json> --apply-now`; the service sets revision, update time, and HEAD. Replace stale facts instead of accumulating prose; do not ask the user to run this bookkeeping command.",
  ];
  return lines.join("\n");
}
