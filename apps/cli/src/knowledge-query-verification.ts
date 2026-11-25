import { readRepositoryFile } from "@lervo/context";
import { loadRepositoryKnowledgePolicy } from "@lervo/repository-knowledge";
import {
  verifyRepositoryContextOutcome,
  withRepositoryQualityObservation,
  recordContextQualityVerification,
  type prepareRepositoryQualityContext,
  type ContextOutcomeDefinition,
  type RepositoryQualityInput,
} from "@lervo/repository-context";

/**
 * Prepares the query's quality context and, when asked, verifies an artifact. The artifact, its
 * baseline, and its definition are files of `checkoutRoot`, the checkout the session works in,
 * which a linked worktree passes while its observations record into the registered repository.
 */
export function observeKnowledgeQueryArtifact(
  preparation: RepositoryQualityInput,
  verification: {
    artifactPath: string;
    planDigest: string;
    baselinePath?: string;
    definitionPath?: string;
  } | null,
  checkoutRoot: string = preparation.repositoryRoot,
): Promise<{
  preparation: Awaited<ReturnType<typeof prepareRepositoryQualityContext>>;
  value: {
    verification: Awaited<ReturnType<typeof verifyRepositoryContextOutcome>> | null;
    verificationRecording: Awaited<ReturnType<typeof recordContextQualityVerification>> | null;
  };
}> {
  return withRepositoryQualityObservation(preparation, async (quality) => {
    const observation = verification
      ? await verifyKnowledgeQueryArtifact({
          preparation: { ...preparation, repositoryRoot: checkoutRoot },
          ...verification,
        })
      : null;
    const recording =
      observation && quality.observationBindings
        ? await recordContextQualityVerification({
            repositoryRoot: preparation.repositoryRoot,
            requestId: quality.result.requestId,
            policySetDigest: quality.observationBindings.policySetDigest,
            projectId: quality.observationBindings.projectId,
            observation,
          })
        : null;
    return { verification: observation, verificationRecording: recording };
  });
}

async function verifyKnowledgeQueryArtifact(input: {
  preparation: RepositoryQualityInput;
  artifactPath: string;
  planDigest: string;
  baselinePath?: string;
  definitionPath?: string;
}) {
  const repositoryRoot = input.preparation.repositoryRoot;
  const definition: ContextOutcomeDefinition = input.definitionPath
    ? (JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          await readRepositoryFile(repositoryRoot, input.definitionPath, 32768),
        ),
      ) as ContextOutcomeDefinition)
    : {
        definitionId: "repository.publication.v1",
        language: (await loadRepositoryKnowledgePolicy(repositoryRoot)).publication.language,
        preserveProtectedMaterial: true,
      };
  return verifyRepositoryContextOutcome({
    preparation: input.preparation,
    artifactPath: input.artifactPath,
    planDigest: input.planDigest,
    definition,
    isPublication: true,
    ...(input.baselinePath
      ? { baselineBytes: await readRepositoryFile(repositoryRoot, input.baselinePath, 1048576) }
      : {}),
  });
}
