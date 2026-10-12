import type { RepositoryKnowledgeQueryRanker } from "@lervo/repository-knowledge";
import {
  LEXICAL_V2_ADAPTER_BUILD_ID,
  LEXICAL_V2_SEARCH_ENGINE,
  LexicalV2SearchIndex,
  LexicalV2FieldAnalysisCache,
} from "@lervo/search-adapter-lexical-v2";

export const productDefaultRepositoryKnowledgeRanker: RepositoryKnowledgeQueryRanker = {
  prepare(entries, reuse) {
    const previous = reuse?.previousProjection as
      { adapterBuildId?: unknown; fields?: unknown } | null | undefined;
    const fields =
      reuse === undefined
        ? undefined
        : new LexicalV2FieldAnalysisCache(
            previous?.adapterBuildId === LEXICAL_V2_ADAPTER_BUILD_ID ? previous.fields : null,
          );
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
      fields === undefined ? {} : { fieldCache: fields },
    );
    const projection = fields?.snapshot();
    return {
      engine: LEXICAL_V2_SEARCH_ENGINE,
      adapterBuildId: LEXICAL_V2_ADAPTER_BUILD_ID,
      ...(projection == null
        ? {}
        : {
            preparationProjection: {
              adapterBuildId: LEXICAL_V2_ADAPTER_BUILD_ID,
              fields: projection,
            },
          }),
      rank(input) {
        return index.search(input.query, input.limit).hits.map((hit) => ({
          conceptId: hit.source.sourceId,
          score: hit.score,
        }));
      },
    };
  },
};
