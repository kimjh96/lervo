import { SEARCH_ENGINE, type SearchEngineIdentity } from "./types.js";

/** The built-in lexical engine, used when no product default is supplied. */
export interface BaselineSearchEngineSelection {
  mode: "baseline";
  candidateId: null;
  engine: SearchEngineIdentity;
  reviewId: null;
  comparisonId: null;
}

export function baselineSearchEngineSelection(): BaselineSearchEngineSelection {
  return {
    mode: "baseline",
    candidateId: null,
    engine: { ...SEARCH_ENGINE },
    reviewId: null,
    comparisonId: null,
  };
}
