import { SearchEvaluationEngineRegistry } from "@lervo/search";
import { bm25fSearchEvaluationEngine } from "@lervo/search-adapter-bm25f";
import { lexicalV2SearchEvaluationEngine } from "@lervo/search-adapter-lexical-v2";

export const searchCandidateRegistry = new SearchEvaluationEngineRegistry([
  { candidateId: "bm25f-v1", engine: bm25fSearchEvaluationEngine },
  { candidateId: "lexical-v2", engine: lexicalV2SearchEvaluationEngine },
]);
