import {
  executeSearchEvaluation,
  LexicalSearchIndex,
  type SearchEvaluationResult,
  type SearchEvaluationRun,
  type SearchEvaluationCase,
} from "@lervo/search";

import { loadRegisteredDocumentCorpus } from "./corpus.js";
import { selectSearchEvaluationCases } from "./evaluation-case-selection.js";
import { loadSearchEvaluationCases } from "./evaluation-case-files.js";
import { LocalSearchEvaluationStore } from "./evaluation-store.js";
import { SearchLocalError } from "./types.js";

export interface LocalSearchEvaluationOutput {
  run: SearchEvaluationRun;
  results: SearchEvaluationResult[];
}

export async function runLocalSearchEvaluation(input: {
  repositoryRoot: string;
  projectId: string;
  evaluatedAt: Date;
  caseIds?: readonly string[];
}): Promise<LocalSearchEvaluationOutput> {
  const [availableCases, corpus] = await Promise.all([
    loadSearchEvaluationCases(input.repositoryRoot),
    loadRegisteredDocumentCorpus(input.repositoryRoot),
  ]);
  let cases: SearchEvaluationCase[];
  if (input.caseIds === undefined) cases = availableCases;
  else cases = selectSearchEvaluationCases(availableCases, input.caseIds);
  if (cases.length === 0) {
    throw new SearchLocalError(
      "evaluation_not_found",
      "No search evaluation cases are available to replay.",
    );
  }
  if (cases.some((evaluationCase) => evaluationCase.projectId !== input.projectId)) {
    throw new SearchLocalError(
      "evaluation_case_invalid",
      "The search evaluation case has different project coordinates.",
    );
  }
  const index = new LexicalSearchIndex(corpus);
  const { results, run } = await executeSearchEvaluation({
    index,
    cases,
    evaluatedAt: input.evaluatedAt,
  });
  const store = await LocalSearchEvaluationStore.open(input.repositoryRoot);
  await store.record({ cases, results, run });
  return { run, results };
}
