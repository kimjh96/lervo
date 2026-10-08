import {
  createConfiguredDocumentNormalizationPreflight,
  type RepositoryDocumentNormalizationCompiler,
} from "@lervo/repository-knowledge";

/** One scan supplies all byte/cache costs; narrowing never repeats repository preflight. */
export async function selectNormalizationBatchWithinCallBudget(input: {
  repositoryRoot: string;
  paths: readonly string[];
  compiler: RepositoryDocumentNormalizationCompiler;
  maximumSourceBytes: number;
  maximumProviderCalls: number;
}): Promise<string[]> {
  const generatorCalls = input.maximumProviderCalls - 1;
  const preflight = await createConfiguredDocumentNormalizationPreflight({
    repositoryRoot: input.repositoryRoot,
    compiler: input.compiler,
    sourcePaths: input.paths,
    ceilings: {
      maximumSourceBytes: input.maximumSourceBytes,
      maximumProviderCalls: generatorCalls,
      maximumElapsedMilliseconds: 25 * 60_000,
    },
  });
  if (!preflight.blockers.length) return [...input.paths];
  const costs = new Map(preflight.selection.documents.map((document) => [document.path, document]));
  const paths: string[] = [];
  let misses = 0,
    bytes = 0;
  for (const path of input.paths) {
    const cost = costs.get(path);
    if (cost === undefined) continue;
    const nextMisses = misses + (cost.cache === "hit" ? 0 : 1);
    // At most two documents share an envelope; every miss and possible pair fallback is reserved.
    const calls = nextMisses + Math.floor(nextMisses / 2);
    if (calls > generatorCalls || bytes + cost.byteCount > input.maximumSourceBytes) continue;
    paths.push(path);
    misses = nextMisses;
    bytes += cost.byteCount;
  }
  return paths;
}
