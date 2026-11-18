import type {
  OperatingActionKind,
  OperatingActionPlanV1,
  OutcomeSupervisionReportV1,
} from "@lervo/application-contract";

/**
 * Whether one proposed plan is an effect the report's next action may take. Admission against the
 * mandate stays separate; this only rejects a plan that answers a different supervision state.
 */
export function supervisionEffectMapped(
  report: {
    reasonCode: string;
    nextAction: NonNullable<OutcomeSupervisionReportV1["nextAction"]>;
  },
  plan: Pick<OperatingActionPlanV1, "actionKind" | "effectContract">,
  mandateActionKinds: readonly OperatingActionKind[],
): boolean {
  // The principal proxy decides within its mandate; it never escalates to the owner again.
  const principalProxy = report.reasonCode.startsWith("principal_proxy_");
  const allowedActions = principalProxy
    ? mandateActionKinds.filter((kind) => kind !== "escalate")
    : report.reasonCode === "workforce_plan_required"
      ? ["allocate_existing", "execute_as_owner", "hire_worker", "request_team_support"]
      : // An exhausted rework may escalate or be replaced by a fresh assignment; each fresh
        // assignment keeps its own attempt limit, and the owner spend epoch bounds the chain.
        report.reasonCode === "acceptance_rejected" && report.nextAction === "escalate"
        ? ["escalate", "allocate_existing"]
        : report.nextAction === "complete_workstream"
          ? // Accepted work may leave requested goal scope unallocated.
            ["execute_as_owner", "allocate_existing", "hire_worker", "request_team_support"]
          : report.nextAction === "review_artifacts"
            ? ["execute_as_owner"]
            : report.nextAction === "reconcile_cancellation"
              ? ["inspect_uncertain_effect"]
              : [report.nextAction];
  const ownerReasoning =
    plan.actionKind === "execute_as_owner" &&
    plan.effectContract === "work.owner_reasoning.v1" &&
    report.nextAction !== "reconcile_cancellation";
  const workspacePreparation =
    report.nextAction === "dispatch" &&
    plan.actionKind === "execute_as_owner" &&
    plan.effectContract === "work.workspace_preparation.v1";
  const successorClaim =
    ["allocate_existing", "dispatch", "inspect_uncertain_effect"].includes(report.nextAction) &&
    plan.actionKind === "revise_responsibility" &&
    ["work.responsibility_claim.v1", "work.assignment_amendment.v1"].includes(plan.effectContract);
  const scopedHandoff =
    report.nextAction !== "reconcile_cancellation" &&
    !(principalProxy && plan.actionKind === "escalate") &&
    ((["request_team_support", "escalate"].includes(plan.actionKind) &&
      plan.effectContract === "work.scoped_handoff.v1") ||
      (plan.actionKind === "execute_as_owner" &&
        plan.effectContract === "work.scoped_handoff_acceptance.v1"));
  const ownerAttention =
    !principalProxy &&
    report.nextAction !== "reconcile_cancellation" &&
    plan.actionKind === "escalate" &&
    plan.effectContract === "work.owner_attention.v1";
  const blockedArtifactReview =
    report.reasonCode === "acceptance_blocked" &&
    report.nextAction === "escalate" &&
    plan.actionKind === "execute_as_owner" &&
    plan.effectContract === "work.artifact_review.v1";
  return (
    ownerReasoning ||
    workspacePreparation ||
    successorClaim ||
    scopedHandoff ||
    ownerAttention ||
    blockedArtifactReview ||
    allowedActions.includes(plan.actionKind)
  );
}
