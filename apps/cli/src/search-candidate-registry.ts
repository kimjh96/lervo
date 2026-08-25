import { SearchEvaluationEngineRegistry } from "@lervo/search";
import { bm25fSearchEvaluationEngine } from "@lervo/search-adapter-bm25f";
import { localHybridSearchEvaluationEngine } from "@lervo/search-adapter-local-hybrid";

export const searchCandidateRegistry = new SearchEvaluationEngineRegistry([
  { candidateId: "bm25f-v1", engine: bm25fSearchEvaluationEngine },
  { candidateId: "local-hybrid-v1", engine: localHybridSearchEvaluationEngine },
]);
