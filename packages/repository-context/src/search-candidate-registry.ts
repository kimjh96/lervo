import { SearchEvaluationEngineRegistry } from "@lervo/search";
import { lexicalV2SearchEvaluationEngine } from "@lervo/search-adapter-lexical-v2";

export const searchCandidateRegistry = new SearchEvaluationEngineRegistry([
  { candidateId: "lexical-v2", engine: lexicalV2SearchEvaluationEngine },
]);
