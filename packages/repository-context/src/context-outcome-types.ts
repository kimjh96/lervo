import { canonicalHash } from "@lervo/search";
import type { ArtifactTaskDefinition, ArtifactTaskEvaluator } from "@lervo/verification";
import type { PublicationLanguageException, WritingSemanticEvaluator } from "@lervo/writing";

export const contextOutcomeEvaluatorBuild = canonicalHash({
  id: "lervo.context-outcome",
  version: 2,
});
export interface ContextOutcomeDefinition {
  definitionId: string;
  language: string;
  preserveProtectedMaterial: boolean;
  task?: ArtifactTaskDefinition;
  languageException?: PublicationLanguageException;
}
export interface ContextOutcomeInput {
  repositoryRoot: string;
  artifactPath: string;
  planDigest: string;
  definition: ContextOutcomeDefinition;
  baselineBytes?: Uint8Array;
  isPublication: boolean;
  evaluator?: WritingSemanticEvaluator;
  taskEvaluator?: ArtifactTaskEvaluator;
  authorizeLanguageException?: (exception: PublicationLanguageException) => Promise<boolean>;
  assertPlanCurrent(): Promise<void>;
  now?: () => Date;
}
export function freezeOutcomeInput(input: ContextOutcomeInput): ContextOutcomeInput {
  return {
    ...input,
    definition: structuredClone(input.definition),
    ...(input.baselineBytes === undefined
      ? {}
      : { baselineBytes: new Uint8Array(input.baselineBytes) }),
  };
}
