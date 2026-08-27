import { SearchEvaluationEngineRegistry } from "@lervo/search";
import { bm25fSearchEvaluationEngine } from "@lervo/search-adapter-bm25f";

export const searchCandidateRegistry = new SearchEvaluationEngineRegistry([
  { candidateId: "bm25f-v1", engine: bm25fSearchEvaluationEngine },
]);
