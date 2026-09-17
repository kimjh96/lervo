import { captureRepositorySnapshot } from "@lervo/orchestrator";
import { projectRepositoryKnowledgeSearch } from "@lervo/product-surface-projection";
import { productDefaultRepositoryKnowledgeRanker } from "@lervo/repository-context";
import { queryRepositoryKnowledge, type KnowledgeQueryResult } from "@lervo/repository-knowledge";
import type { ProductUnifiedSearchResultV1 } from "@lervo/schemas";
import {
  LEXICAL_V2_ADAPTER_BUILD_ID,
  LEXICAL_V2_SEARCH_ENGINE,
} from "@lervo/search-adapter-lexical-v2";

import { collectLocalKnowledgeSources } from "./knowledge-sources.js";

export interface ProductSearchInspectionInput {
  repositoryRoot: string;
  query: string;
  corpusClass: "repository_knowledge";
  limit: number;
}

export type InspectProductSearch = (
  input: ProductSearchInspectionInput,
) => Promise<ProductUnifiedSearchResultV1>;

interface ProductSearchInspectionDependencies {
  captureSnapshot(root: string): Promise<{ revision: string }>;
  queryKnowledge(input: {
    repositoryRoot: string;
    query: string;
    limit: number;
  }): Promise<KnowledgeQueryResult>;
}

const defaultDependencies: ProductSearchInspectionDependencies = {
  captureSnapshot: captureRepositorySnapshot,
  async queryKnowledge(input) {
    const supplementalSources = await collectLocalKnowledgeSources(input.repositoryRoot);
    return queryRepositoryKnowledge({
      ...input,
      supplementalSources,
      ranker: productDefaultRepositoryKnowledgeRanker,
    });
  },
};

function assertQualifiedLexicalV2(result: KnowledgeQueryResult): void {
  if (
    result.ranking?.engine.id !== LEXICAL_V2_SEARCH_ENGINE.id ||
    result.ranking.engine.version !== LEXICAL_V2_SEARCH_ENGINE.version ||
    result.ranking.adapterBuildId !== LEXICAL_V2_ADAPTER_BUILD_ID
  ) {
    throw new Error("Product search did not observe the qualified Lexical v2 adapter build.");
  }
}

export async function inspectProductSearch(
  input: ProductSearchInspectionInput,
  dependencies: ProductSearchInspectionDependencies = defaultDependencies,
): Promise<ProductUnifiedSearchResultV1> {
  const before = await dependencies.captureSnapshot(input.repositoryRoot);
  const result = await dependencies.queryKnowledge({
    repositoryRoot: input.repositoryRoot,
    query: input.query,
    limit: input.limit,
  });
  const after = await dependencies.captureSnapshot(input.repositoryRoot);
  if (after.revision !== before.revision) {
    throw new Error(
      "The repository changed during product search; retry against a stable revision.",
    );
  }
  assertQualifiedLexicalV2(result);
  return projectRepositoryKnowledgeSearch({
    query: input.query,
    authorizationCoordinate: "local-cli:repository-reader",
    repositoryRevision: after.revision,
    adapterId: "search/lexical-v2",
    result,
    limit: input.limit,
  });
}
