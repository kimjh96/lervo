import { correctContextOutcome } from "./context-outcome-correction.js";
import { repositoryOutcomeInput } from "./repository-context-outcome.js";
import type { ContextOutcomeCorrectionPorts } from "./context-outcome-correction-types.js";

export async function correctRepositoryContextOutcome(
  input: Parameters<typeof repositoryOutcomeInput>[0],
  ports: ContextOutcomeCorrectionPorts,
) {
  return correctContextOutcome(repositoryOutcomeInput(input), ports);
}
