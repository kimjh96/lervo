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
    // ADR-0561: the background canonical reviewer resolves every candidate; none waits for the owner.
    case "canonicalization_review":
      actor = "canonical reviewer";
      waitingSince = item.createdAt;
      recommendation = "Resolve the candidate in the next background review";
      inspectCommand = `lervo knowledge canonicalization status ${item.candidateId} --json`;
      break;
    // ADR-0561: freshness never waits for the owner; held work is Lervo debt with backoff.
    case "document_freshness_candidate":
      actor = "resident freshness cycle";
      waitingSince = item.createdAt ?? null;
      recommendation = "Retry the cross-check and apply what it agrees";
      inspectCommand = `lervo knowledge freshness review ${item.candidateId}`;
      break;
    case "document_freshness_applied":
      actor = "resident freshness cycle";
      inspectCommand = "lervo knowledge freshness status";
      break;
    case "document_freshness_blocked":
      actor = "resident freshness cycle";
      waitingSince = item.since;
      recommendation = `Retry with backoff at ${item.retryAt}`;
      inspectCommand = "lervo knowledge freshness status";
      break;
    // ADR-0561: instruction capture never waits for the owner; each item is Lervo debt.
    case "durable_instruction_candidate":
      actor = "knowledge resident";
      waitingSince = item.createdAt ?? null;
      recommendation = "Apply the stored owner rule in the next cycle";
      inspectCommand = `lervo knowledge instruction status ${item.candidateId}`;
      break;
    case "captured_decision":
      actor = "knowledge resident";
      waitingSince = item.capturedAt;
      recommendation =
        item.heldKind === "decision"
          ? "Document the owner decision once it can be grounded as a canonical rule"
          : "Keep the rejected rule as debt until the owner states it again";
      inspectCommand = "lervo knowledge instruction capture";
      break;
    case "instruction_capture_blocked":
      actor = "knowledge resident";
      waitingSince = item.since;
      recommendation = "Assess queued owner turns once a convergence delegation is active";
      inspectCommand = "lervo knowledge convergence doctor --json";
      break;
    // ADR-0561: continuity renews within the installed policy limits; held continuity is Lervo debt.
    case "knowledge_convergence_continuity":
      actor = "knowledge resident";
      waitingSince = item.observedAt;
      recommendation = "Restore continuity within the installed policy limits";
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
    // ADR-0561: the coordinator backs up the losing side and prefers the configured one itself.
    case "repository_replica_divergence":
      actor = "replica coordinator";
      waitingSince = item.openedAt;
      recommendation = "Save the losing side to a backup branch and apply the configured side";
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
