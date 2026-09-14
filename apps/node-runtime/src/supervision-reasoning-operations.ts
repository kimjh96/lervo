import { ownerReasoningDecisionSchema } from "@lervo/work-controller";
import type { OwnerReasoningContext } from "./supervision-reasoning-context.js";

/** Constrains the provider response to the observed lifecycle stage; admission remains separate. */
export function supervisionReasoningDecisionSchema(context: OwnerReasoningContext) {
  const schema = structuredClone(ownerReasoningDecisionSchema);
  let operations: readonly string[] = schema.properties.operation.enum;
  if (context.trigger.reasonCode === "scoped_handoff_acceptance_required") {
    operations = ["accept_team_support", "escalate"];
  } else if (context.trigger.reasonCode === "acceptance_blocked") {
    operations = ["review_artifacts", "escalate"];
  } else if (context.trigger.nextAction === "review_artifacts") {
    const tasks = context.facts.tasks.assignments.filter((item) =>
      context.trigger.assignmentIds.includes(item.assignmentId),
    );
    operations = [
      ...(tasks.some((item) => item.status === "leased" && item.review === null)
        ? ["prepare_completion"]
        : []),
      ...(tasks.some((item) => item.status === "completed") ? ["review_artifacts"] : []),
      "escalate",
    ];
  } else if (context.trigger.nextAction === "request_rework") {
    operations = ["request_rework", "escalate"];
  } else if (context.trigger.nextAction === "complete_workstream") {
    operations = ["complete_workstream", "escalate"];
  } else if (context.trigger.nextAction === "publish_result") {
    operations = ["prepare_publication", "escalate"];
  }
  return {
    ...schema,
    properties: { ...schema.properties, operation: { type: "string", enum: [...operations] } },
  };
}
