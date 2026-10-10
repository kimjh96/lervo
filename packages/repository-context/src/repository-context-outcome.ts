import { canonicalHash } from "@lervo/search";
import { loadRepositoryKnowledgePolicy } from "@lervo/repository-knowledge";
import { freezeOutcomeInput, type ContextOutcomeInput } from "./context-outcome-types.js";
import { ContextQualityError } from "@lervo/context";
import { verifyContextOutcome } from "./context-outcome-verification.js";
import {
  prepareRepositoryQualityContext,
  type RepositoryQualityInput,
} from "./repository-quality-context.js";

/** Re-resolve local rules, policy, source bytes and scope around the exact artifact evaluation. */
export function repositoryOutcomeInput(
  input: Omit<
    Parameters<typeof verifyContextOutcome>[0],
    "repositoryRoot" | "assertPlanCurrent"
  > & {
    preparation: RepositoryQualityInput;
  },
): ContextOutcomeInput {
  const { preparation, ...outcome } = input;
  const frozen = {
    ...preparation,
    recordObservation: false,
    task: structuredClone(preparation.task),
    candidates: structuredClone(preparation.candidates),
    ...(preparation.projectedQueries === undefined
      ? {}
      : { projectedQueries: [...preparation.projectedQueries] }),
  };
  const definition = structuredClone(outcome.definition);
  return freezeOutcomeInput({
    ...outcome,
    definition,
    repositoryRoot: frozen.repositoryRoot,
    assertPlanCurrent: async () => {
      if (definition.task && definition.task.taskDigest !== canonicalHash(frozen.task))
        throw new ContextQualityError("context_binding_stale");
      if (
        outcome.isPublication &&
        definition.language !==
          (await loadRepositoryKnowledgePolicy(frozen.repositoryRoot)).publication.language
      )
        throw new ContextQualityError("context_binding_stale");
      const current = await prepareRepositoryQualityContext(frozen);
      if (!current.result.plan)
        throw new ContextQualityError(
          current.result.status === "stale"
            ? "context_binding_stale"
            : "context_binding_unavailable",
        );
      if (current.result.plan.planDigest !== outcome.planDigest)
        throw new ContextQualityError("context_binding_stale");
    },
  });
}

export async function verifyRepositoryContextOutcome(
  input: Parameters<typeof repositoryOutcomeInput>[0],
) {
  return verifyContextOutcome(repositoryOutcomeInput(input));
}
