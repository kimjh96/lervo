import type {
  OperatingAttentionItemV1,
  RepositoryHealthAttentionV1,
} from "@lervo/application-contract";

const ATTENTION = "lervo application attention --json";

/** Authority comes from structured state, never from words such as 'review' in an instruction. */
export function attributeOperatingAttention(
  item: OperatingAttentionItemV1,
  now: Date,
): OperatingAttentionItemV1 {
  const prior = item.attribution;
  let actor = "resident";
  let consequence: string | null = null;
  let recommendation = "Recover within the existing delegation";
  let inspectCommand = ATTENTION;
  let waitingSince: string | null = null;
  switch (item.kind) {
    case "workstream_approval":
      consequence = item.consequence === "unclassified" ? null : item.consequence;
      recommendation = `Review the exact binding for ${item.approvalId}`;
      inspectCommand = "lervo workstream current --context";
      break;
    case "workstream_decision":
      actor = "principal proxy";
      recommendation = item.recommendedChoiceId ?? "Classify the consequence before escalation";
      inspectCommand = "lervo workstream current --context";
      break;
    case "workstream_blocker":
      actor = "working agent";
      break;
    case "canonicalization_review":
      actor = "canonical reviewer";
      waitingSince = item.createdAt;
      inspectCommand = `lervo knowledge canonicalization status ${item.candidateId} --json`;
      break;
    case "document_freshness_candidate":
      actor = "resident freshness cycle";
      consequence = item.ownerConsequence ?? null;
      waitingSince = item.createdAt ?? null;
      recommendation = "Review the verified candidate before authorizing its held effect";
      inspectCommand = `lervo knowledge freshness review ${item.candidateId}`;
      break;
    case "document_freshness_applied":
    case "document_freshness_blocked":
      actor = "resident freshness cycle";
      inspectCommand = "lervo knowledge freshness status";
      break;
    case "durable_instruction_candidate":
      actor = "instruction reviewer";
      waitingSince = item.createdAt ?? null;
      inspectCommand = `lervo knowledge instruction status ${item.candidateId}`;
      break;
    case "captured_decision":
      actor = "principal proxy";
      waitingSince = item.capturedAt;
      recommendation = "Document the settled decision or resolve its scope under the mandate";
      inspectCommand = "lervo knowledge instruction capture";
      break;
    case "instruction_capture_blocked":
      consequence = "authority_scope";
      waitingSince = item.since;
      recommendation = "Authorize a bounded knowledge convergence delegation";
      inspectCommand = "lervo knowledge convergence doctor --json";
      break;
    case "knowledge_convergence_continuity":
      consequence = item.severity === "owner_decision" ? "authority_scope" : null;
      waitingSince = item.observedAt;
      recommendation = "Review the continuity scope and renew only its bounded authority";
      inspectCommand = "lervo knowledge convergence doctor --json";
      break;
    case "knowledge_convergence_owner":
      waitingSince = item.observedAt;
      if (item.failureCode === "hub_forbidden") {
        consequence = "authority_scope";
        recommendation =
          "Grant bounded workspace.read and workspace.coordinate for the configured Hub scope";
      }
      if (item.failureCode === "hub_unauthorized") {
        consequence = "credentials";
        recommendation =
          "Replace the rejected Hub token for the configured project and destination";
      }
      if (item.failureCode === "token_file_unreadable") {
        consequence = "credentials";
        recommendation = "Restore owner-only access to the configured Hub token file";
      }
      inspectCommand = "lervo knowledge convergence owner status";
      break;
    case "knowledge_publication":
      actor = "knowledge publisher";
      waitingSince = item.firstObservedAt;
      inspectCommand = "lervo knowledge convergence owner status";
      // A forge failure classed `auth` needs the owner's gh login; Lervo cannot repair credentials.
      if (/^gh \S+ exit \S+ auth$/u.test(item.detail ?? "")) {
        consequence = "credentials";
        recommendation = "Log gh in with an account that can push and merge this repository";
      }
      break;
    case "repository_replica_divergence":
      actor = "replica coordinator";
      consequence = "repository_write";
      waitingSince = item.openedAt;
      recommendation = "Choose the authoritative replica before overwriting conflicting bytes";
      break;
    case "knowledge_lifecycle":
      if (item.issueCode === "turn_approval_pending") {
        consequence = "repository_write";
        recommendation = "Inspect the pending exact repository write approval";
      }
      if (item.issueCode === "repository_layout_decision_pending") {
        consequence = "repository_write";
        recommendation = "Accept the one repository layout decision (recommended) or decline it";
        inspectCommand = item.instruction;
      }
      break;
  }
  if (prior?.waitingSince) waitingSince = prior.waitingSince;
  const requiresUserAction = consequence !== null && item.state !== "stale";
  const attribution: RepositoryHealthAttentionV1 = {
    itemId: item.itemId,
    kind: item.kind,
    actor: requiresUserAction ? "owner" : actor,
    requiresUserAction,
    consequence: requiresUserAction ? consequence : null,
    recommendation,
    inspectCommand,
    waitingSince,
    ageMilliseconds:
      waitingSince === null ||
      !Number.isFinite(Date.parse(waitingSince)) ||
      Date.parse(waitingSince) > now.getTime()
        ? null
        : Math.max(0, now.getTime() - Date.parse(waitingSince)),
  };
  return {
    ...item,
    actionOwner: requiresUserAction ? "user" : actor.includes("reviewer") ? "reviewer" : "agent",
    requiresUserAction,
    blocking:
      item.state !== "stale" && (requiresUserAction || item.kind === "workstream_blocker")
        ? item.blocking
        : false,
    attribution,
    recordedInstruction: item.recordedInstruction ?? item.instruction,
    instruction:
      requiresUserAction || item.state === "stale"
        ? item.instruction
        : `${actor}: ${recommendation}. Inspect with ${inspectCommand}.`,
  };
}
