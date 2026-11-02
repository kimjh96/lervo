import {
  declineRepositoryLayoutDecision,
  repositoryLayoutDecision,
  repositoryLayoutDecisionDeclined,
  repositoryLayoutDecisionApprovals,
  repositoryLayoutDecisionToken,
  validRepositoryLayoutDecisionToken,
  type RepositoryLayoutDecision,
  type RepositoryLayoutMigrationPlan,
} from "@lervo/repository-knowledge";

/** ADR-0559: the one command that accepts a layout decision, and the one that declines it. */
export function repositoryLayoutDecisionCommands(decision: RepositoryLayoutDecision): {
  accept: string;
  decline: string;
} {
  return {
    accept: `lervo migrate knowledge --accept-layout ${repositoryLayoutDecisionToken(decision)}`,
    decline: `lervo migrate knowledge --decline-layout ${decision.decisionId}`,
  };
}

/** One sentence naming what the decision moves and the recommendation. */
export function repositoryLayoutDecisionSummary(decision: RepositoryLayoutDecision): string {
  const destinations = decision.destinations
    .map((item) => `${item.count} to ${item.directory}/`)
    .join(", ");
  const updates =
    decision.userUpdateCount === 0 ? "" : `, update ${decision.userUpdateCount} user documents`;
  return `Move ${decision.moveCount} documents (${destinations})${updates}, rewriting ${decision.referenceUpdateCount} references. Recommendation: accept.`;
}

export function formatRepositoryLayoutDecision(decision: RepositoryLayoutDecision): string[] {
  const commands = repositoryLayoutDecisionCommands(decision);
  return [
    `Layout decision: ${decision.decisionId}`,
    `  ${repositoryLayoutDecisionSummary(decision)}`,
    `  Accept: ${commands.accept}`,
    `  Decline: ${commands.decline}`,
  ];
}

/**
 * The decision an upgrade reports for a serialized `review_required` layout plan: "declined"
 * when the owner already declined it, its summary and commands when pending, or null.
 */
export async function pendingLayoutDecision(
  repositoryRoot: string,
  serializedPlan: Record<string, unknown>,
): Promise<
  "declined" | { decisionId: string; summary: string; accept: string; decline: string } | null
> {
  if (
    !["moves", "userUpdates", "referenceUpdates", "blockers"].every((key) =>
      Array.isArray(serializedPlan[key]),
    )
  )
    return null;
  const decision = repositoryLayoutDecision(
    serializedPlan as unknown as RepositoryLayoutMigrationPlan,
  );
  if (decision === null) return null;
  if (await repositoryLayoutDecisionDeclined(repositoryRoot, decision.decisionId))
    return "declined";
  return {
    decisionId: decision.decisionId,
    summary: repositoryLayoutDecisionSummary(decision),
    ...repositoryLayoutDecisionCommands(decision),
  };
}

/** Rejects a decision flag that is malformed or combined with explicit item approvals. */
export function validateLayoutDecisionOptions(values: {
  apply?: string;
  "approve-item"?: string[];
  "accept-layout"?: string;
  "decline-layout"?: string;
}): void {
  const accept = values["accept-layout"];
  const decline = values["decline-layout"];
  if (accept === undefined && decline === undefined) return;
  if (accept !== undefined && decline !== undefined)
    throw new Error("Use either --accept-layout or --decline-layout, not both.");
  if (values.apply !== undefined || (values["approve-item"]?.length ?? 0) > 0)
    throw new Error(
      "A layout decision replaces --apply and --approve-item; pass only the decision.",
    );
  if (accept !== undefined && !validRepositoryLayoutDecisionToken(accept))
    throw new Error("--accept-layout must use <decision-id>=<sha256-decision-hash>.");
  if (decline !== undefined && !/^klaydec_[a-f0-9]{24}$/u.test(decline))
    throw new Error("--decline-layout must name a layout decision ID.");
}

/**
 * Resolves a decision flag against the current plan: the exact item approvals to apply for an
 * accepted decision, or the recorded decline. A decision that no longer matches grants nothing.
 */
export async function resolveLayoutDecision(input: {
  plan: RepositoryLayoutMigrationPlan;
  accept?: string;
  decline?: string;
  now: Date;
}): Promise<
  | { kind: "accepted"; approvals: Array<{ operationId: string; approvalHash: string }> }
  | { kind: "declined"; decision: RepositoryLayoutDecision }
> {
  if (input.decline !== undefined)
    return {
      kind: "declined",
      decision: await declineRepositoryLayoutDecision({
        repositoryRoot: input.plan.repositoryRoot,
        plan: input.plan,
        decisionId: input.decline,
        now: input.now,
      }),
    };
  const approvals = repositoryLayoutDecisionApprovals(input.plan, input.accept ?? "");
  if (approvals === null)
    throw new Error(
      repositoryLayoutDecision(input.plan) === null
        ? "No layout decision is pending for the current plan."
        : "The layout decision no longer matches the current plan; run lervo migrate knowledge to see the current decision.",
    );
  return { kind: "accepted", approvals };
}
