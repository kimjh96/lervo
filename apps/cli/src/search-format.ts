import type { SearchResponse } from "@lervo/search";

export function formatSearchResponse(response: SearchResponse, attemptId: string): string {
  const lines = [
    `Search attempt: ${attemptId}`,
    `Index: ${response.indexId} · ${response.engine.id}-v${response.engine.version}`,
    response.hits.length === 0 ? "No results." : `Results (${response.hits.length}):`,
    ...response.hits.map(
      (hit) =>
        `  ${hit.rank}. ${hit.source.sourceId} · ${hit.source.path ?? hit.source.kind} · score ${hit.score}`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}
