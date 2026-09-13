import {
  selectWorkstreamCausalRuns,
  type WorkstreamCausalScope,
} from "./workstream-causal-scope.js";
import { projectManagedResourceGroups } from "./managed-resource-projection.js";

/** Includes owner reasoning and its descendants even when no worker assignment exists. */
export function projectWorkstreamResources(input: WorkstreamCausalScope) {
  const workRuns = selectWorkstreamCausalRuns(input);
  return {
    runIds: workRuns.map((record) => record.runId).sort(),
    groups: projectManagedResourceGroups({ events: input.events, workRuns }),
  };
}
