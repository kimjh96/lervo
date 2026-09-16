import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { operatingContractHash } from "@lervo/work-controller";
import type { createNodeSupervisionEffects } from "./supervision-runtime-effects.js";
import type { SupervisionResultDelivery } from "./supervision-result-delivery.js";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import type { NodeSupervisionSession } from "./supervision-session.js";
import type { NodeOutcomeSupervisionRuntimeInput } from "./supervision-runtime-ports.js";

/** Routes only adapters that can prove non-start under their own current source fence. */
export async function supersedeNodeSupervisionEffect(input: {
  plan: OperatingActionPlanV1;
  sourceRevisionDigest: string;
  session: NodeSupervisionSession;
  binding: NodeSupervisionBinding;
  effects: ReturnType<typeof createNodeSupervisionEffects>;
  delivery: SupervisionResultDelivery | null;
  ports: NodeOutcomeSupervisionRuntimeInput["ports"];
}): Promise<boolean> {
  const { plan, session, binding, effects, delivery, ports } = input;
  const { topology, reasoning, workspaces, managed, claims } = effects;
  const native =
    plan.effectContract === "assignment.topology.materialize.v1" ||
    plan.effectContract === "work.responsibility_claim.v1" ||
    (["work.result_delivery.v1", "work.result_delivery.v2"].includes(plan.effectContract) &&
      delivery !== null) ||
    (plan.effectContract === "work.owner_reasoning.v1" && reasoning !== null) ||
    (plan.effectContract === "work.workspace_preparation.v1" && workspaces !== null) ||
    (["work.managed_execution.v1", "work.managed_execution.v2"].includes(plan.effectContract) &&
      managed !== null);
  let digest = input.sourceRevisionDigest;
  if (native) {
    const [task, authority] = await Promise.all([
      session.readTaskSnapshot(),
      session.readRecoveryAuthority(),
    ]);
    digest = operatingContractHash({
      authorityDigest: authority.source.sourceRevisionDigest,
      taskDigest: task.sourceRevisionDigest,
    });
  }
  if (plan.effectContract === "assignment.topology.materialize.v1")
    return topology.supersede(plan, digest, session);
  if (plan.effectContract === "work.owner_reasoning.v1" && reasoning !== null)
    return reasoning.supersede(plan, digest, session);
  if (plan.effectContract === "work.workspace_preparation.v1" && workspaces !== null)
    return workspaces.supersede(plan, digest, session);
  if (
    ["work.managed_execution.v1", "work.managed_execution.v2"].includes(plan.effectContract) &&
    managed !== null
  )
    return managed.supersede(plan, digest, session, binding);
  if (
    ["work.result_delivery.v1", "work.result_delivery.v2"].includes(plan.effectContract) &&
    delivery !== null
  )
    return delivery.supersede(plan, digest, session);
  if (plan.effectContract === "work.responsibility_claim.v1")
    return claims.supersede(plan, digest, session);
  return "supersedeNotStarted" in ports
    ? (ports.supersedeNotStarted?.(plan, input.sourceRevisionDigest, session) ?? false)
    : false;
}
