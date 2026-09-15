import type { RepositoryKnowledgeQueryRanker } from "@lervo/repository-knowledge";
import {
  LEXICAL_V2_ADAPTER_BUILD_ID,
  LEXICAL_V2_SEARCH_ENGINE,
  LexicalV2SearchIndex,
} from "@lervo/search-adapter-lexical-v2";

export const productDefaultRepositoryKnowledgeRanker: RepositoryKnowledgeQueryRanker = {
  prepare(entries) {
    const index = new LexicalV2SearchIndex(
      entries.map((entry) => ({
        kind: "verified_knowledge" as const,
        sourceId: entry.conceptId,
        contentHash: entry.contentHash,
        path: entry.path,
        title: entry.title,
        labels: entry.labels,
        text: entry.text,
      })),
    );
    return {
      engine: LEXICAL_V2_SEARCH_ENGINE,
      adapterBuildId: LEXICAL_V2_ADAPTER_BUILD_ID,
      rank(input) {
        return index.search(input.query, input.limit).hits.map((hit) => ({
          conceptId: hit.source.sourceId,
          score: hit.score,
        }));
      },
    };
  },
};
