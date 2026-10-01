import {
  createConfiguredDocumentNormalizationPreflight,
  type RepositoryDocumentNormalizationCompiler,
} from "@lervo/repository-knowledge";

/** Keep the largest ordered prefix whose worst-case compiler calls fit the reviewed ceiling. */
export async function selectNormalizationBatchWithinCallBudget(input: {
  repositoryRoot: string;
  paths: readonly string[];
  compiler: RepositoryDocumentNormalizationCompiler;
  maximumSourceBytes: number;
  maximumProviderCalls: number;
}): Promise<string[]> {
  const generatorCalls = input.maximumProviderCalls - 1;
  for (let count = input.paths.length; count > 1; count -= 1) {
    const paths = input.paths.slice(0, count);
    const preflight = await createConfiguredDocumentNormalizationPreflight({
      repositoryRoot: input.repositoryRoot,
      compiler: input.compiler,
      sourcePaths: paths,
      ceilings: {
        maximumSourceBytes: input.maximumSourceBytes,
        maximumProviderCalls: generatorCalls,
        maximumElapsedMilliseconds: 25 * 60_000,
      },
    });
    if (!preflight.blockers.some((blocker) => blocker.code === "provider_calls_exceeded"))
      return paths;
  }
  return input.paths.slice(0, 1);
}
