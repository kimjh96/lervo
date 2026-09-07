import type { AssignmentRoutineRequestV1 } from "@lervo/application-contract";
import {
  assertReadyLiveTriggerPlan,
  liveTriggerHash,
  type LiveTriggerAdmissionPlanV1,
} from "@lervo/live-trigger-contract";

export function assertAssignmentRoutineAuthority(input: {
  request: AssignmentRoutineRequestV1;
  liveTriggerPlan?: LiveTriggerAdmissionPlanV1;
}): void {
  if (input.request.trigger.kind === "manual") {
    if (input.liveTriggerPlan !== undefined)
      throw new Error("Manual assignment routines cannot use live-trigger authority.");
    return;
  }
  if (input.liveTriggerPlan === undefined)
    throw new Error("Authenticated live routines require in-process live-trigger authority.");
  assertReadyLiveTriggerPlan(input.liveTriggerPlan);
  if (liveTriggerHash(input.request) !== liveTriggerHash(input.liveTriggerPlan.request)) {
    throw new Error("The live-trigger authority does not match the routine request.");
  }
}
