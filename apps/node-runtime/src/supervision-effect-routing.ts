import type {
  OperatingActionPlanV1,
  OperatingPolicyReviewV1,
  SupervisionDecisionReceipt,
} from "@lervo/application-contract";
import { operatingReadinessKind } from "@lervo/work-controller";
import type { createNodeSupervisionEffects } from "./supervision-runtime-effects.js";
import type { SupervisionResultDelivery } from "./supervision-result-delivery.js";
import type { NodeSupervisionSession } from "./supervision-session.js";
import type {
  NodeOutcomeSupervisionRuntimeInput,
  NodeSupervisionEffectSession,
} from "./supervision-runtime-ports.js";

type Routing = {
  effects: ReturnType<typeof createNodeSupervisionEffects>;
  delivery: SupervisionResultDelivery | null;
  ports: NodeOutcomeSupervisionRuntimeInput["ports"];
};

/** Routes exact effect contracts after runtime admission; adapters retain their own commit checks. */
export function inspectNodeSupervisionEffect(
  input: Routing & {
    plan: OperatingActionPlanV1;
    receipt: SupervisionDecisionReceipt;
    session: NodeSupervisionSession;
  },
) {
  const { plan, receipt, delivery, ports } = input;
  if (plan.effectContract === "work.owner_attention.v1")
    return input.effects.attention.inspect(plan);
  const session = () => input.session;
  const {
    handoffs,
    amendments,
    recoveries,
    hiring,
    completions,
    workspaces,
    reasoning,
    claims,
    topology,
    ownerControls,
    managed,
  } = input.effects;
  return ["work.scoped_handoff.v1", "work.scoped_handoff_acceptance.v1"].includes(
    plan.effectContract,
  )
    ? handoffs.inspect(plan)
    : plan.effectContract === "work.assignment_amendment.v1"
      ? amendments.inspect(plan, session())
      : ["work.assignment_recovery.v1", "work.assignment_recovery.v2"].includes(plan.effectContract)
        ? recoveries.inspect(plan, session())
        : plan.effectContract === "work.worker_hire.v1" && hiring !== null
          ? hiring.inspect(plan)
          : ["work.assignment_completion.v1", "work.assignment_completion.v2"].includes(
                plan.effectContract,
              )
            ? completions.inspect(plan, session())
            : plan.effectContract === "work.workspace_preparation.v1" && workspaces !== null
              ? workspaces.inspect(plan, session())
              : plan.effectContract === "work.owner_reasoning.v1" && reasoning !== null
                ? reasoning.inspect(plan)
                : plan.effectContract === "work.responsibility_claim.v1"
                  ? claims.inspect(plan)
                  : plan.effectContract === "assignment.topology.materialize.v1"
                    ? topology.inspect(plan, session())
                    : ["work.result_delivery.v1", "work.result_delivery.v2"].includes(
                          plan.effectContract,
                        ) && delivery !== null
                      ? delivery.inspect(plan)
                      : operatingReadinessKind(plan) === "owner_control"
                        ? ownerControls.inspect(plan)
                        : managed !== null &&
                            ["work.managed_execution.v1", "work.managed_execution.v2"].includes(
                              plan.effectContract,
                            )
                          ? managed.inspect(plan)
                          : "inspectEffect" in ports
                            ? ports.inspectEffect(plan, receipt, session())
                            : Promise.reject(
                                new Error("No concrete effect inspector is configured."),
                              );
}

export function executeNodeSupervisionEffect(
  input: Routing & {
    plan: OperatingActionPlanV1;
    review: OperatingPolicyReviewV1;
    owner: NodeSupervisionSession;
    effectSession: NodeSupervisionEffectSession;
    authorityDigest: string;
  },
) {
  const { plan, review, owner, effectSession, authorityDigest, delivery, ports } = input;
  if (plan.effectContract === "work.owner_attention.v1")
    return input.effects.attention.execute(plan, effectSession);
  const {
    handoffs,
    amendments,
    recoveries,
    hiring,
    completions,
    workspaces,
    reasoning,
    claims,
    topology,
    ownerControls,
    managed,
  } = input.effects;
  if (["work.scoped_handoff.v1", "work.scoped_handoff_acceptance.v1"].includes(plan.effectContract))
    return handoffs.execute(plan, effectSession);
  if (plan.effectContract === "work.assignment_amendment.v1")
    return amendments.execute(plan, effectSession);
  if (["work.assignment_recovery.v1", "work.assignment_recovery.v2"].includes(plan.effectContract))
    return recoveries.execute(plan, effectSession);
  return plan.effectContract === "work.worker_hire.v1" && hiring !== null
    ? hiring.execute(plan, effectSession)
    : ["work.assignment_completion.v1", "work.assignment_completion.v2"].includes(
          plan.effectContract,
        )
      ? completions.execute(plan, effectSession)
      : plan.effectContract === "work.workspace_preparation.v1" && workspaces !== null
        ? workspaces.execute(plan, effectSession)
        : plan.effectContract === "work.owner_reasoning.v1" && reasoning !== null
          ? reasoning.execute(plan, effectSession)
          : plan.effectContract === "work.responsibility_claim.v1"
            ? claims.execute(plan, effectSession)
            : plan.effectContract === "assignment.topology.materialize.v1"
              ? topology.execute(plan, effectSession)
              : ["work.result_delivery.v1", "work.result_delivery.v2"].includes(
                    plan.effectContract,
                  ) && delivery !== null
                ? delivery.enqueue(plan, owner, authorityDigest)
                : operatingReadinessKind(plan) === "owner_control"
                  ? ownerControls.execute(plan, effectSession)
                  : managed !== null &&
                      ["work.managed_execution.v1", "work.managed_execution.v2"].includes(
                        plan.effectContract,
                      )
                    ? managed.execute(plan, effectSession)
                    : "execute" in ports
                      ? ports.execute(plan, review, effectSession)
                      : Promise.reject(new Error("No concrete effect adapter is configured."));
}
