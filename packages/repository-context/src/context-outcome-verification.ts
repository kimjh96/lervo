import { ContextQualityError, readRepositoryFile } from "@lervo/context";
import { sha256 } from "@lervo/repository-knowledge";
import { evaluateContextOutcomeBytes } from "./context-outcome-evaluation.js";
import { freezeOutcomeInput, type ContextOutcomeInput } from "./context-outcome-types.js";
export {
  contextOutcomeEvaluatorBuild,
  type ContextOutcomeDefinition,
} from "./context-outcome-types.js";

/** Read-only observation; publication and repository effect owners retain their authority. */
export async function verifyContextOutcome(source: ContextOutcomeInput) {
  const input = freezeOutcomeInput(source);
  const bytes = await readRepositoryFile(input.repositoryRoot, input.artifactPath, 1048576);
  return evaluateContextOutcomeBytes(input, bytes, async () => {
    if (
      sha256(await readRepositoryFile(input.repositoryRoot, input.artifactPath, 1048576)) !==
      sha256(bytes)
    )
      throw new ContextQualityError("context_binding_stale");
  });
}
