import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import type { OutcomeSupervisionPorts } from "@lervo/orchestrator";
import { evaluateWorkerReadiness, operatingContractHash } from "@lervo/work-controller";
import { NodeSupervisionError } from "./supervision-authority.js";

type Readiness = Awaited<ReturnType<OutcomeSupervisionPorts["readWorkerReadiness"]>>;

/** Translates verified task-source observations into the Node's combined authority/task scope. */
export function bindNodeSupervisionReadiness(input: {
  plan: OperatingActionPlanV1;
  readiness: Readiness;
  sourceBinding: { taskDigest: string; combined: string } | null;
}): Readiness {
  const { plan, sourceBinding } = input;
  const readiness = structuredClone(input.readiness);
  const { responsibility, observation } = readiness;
  if (
    sourceBinding === null ||
    plan.sourceRevisionDigest !== sourceBinding.combined ||
    observation.sourceRevisionDigest !== sourceBinding.taskDigest ||
    operatingContractHash(responsibility) !== plan.responsibilityArtifactHash ||
    responsibility.roleId !== plan.roleId ||
    (plan.actionKind === "execute_as_owner" &&
      responsibility.executorAgentId !== plan.ownerAgentId) ||
    responsibility.requiredCapabilities.some(
      (capability) => !plan.requiredCapabilities.includes(capability),
    ) ||
    responsibility.expectedPaths.some(
      (path) => !plan.expectedPaths.some((scope) => path === scope || path.startsWith(`${scope}/`)),
    )
  )
    throw new NodeSupervisionError("supervision_readiness_changed");
  return {
    ...readiness,
    observation: { ...observation, sourceRevisionDigest: sourceBinding.combined },
  };
}

/** Re-evaluate after all asynchronous admission reads, immediately before effect invocation. */
export function assertNodeSupervisionReadiness(input: {
  readiness: Readiness;
  sourceRevisionDigest: string;
  now: string;
}): void {
  const age = Date.parse(input.now) - Date.parse(input.readiness.observation.observedAt);
  const result = evaluateWorkerReadiness({
    ...input.readiness,
    sourceRevisionDigest: input.sourceRevisionDigest,
    now: input.now,
  });
  if (!Number.isFinite(age) || age < 0 || age > 5000 || result.status !== "ready")
    throw new NodeSupervisionError("supervision_readiness_changed");
}
