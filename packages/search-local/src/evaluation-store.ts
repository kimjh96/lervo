import { resolve } from "node:path";

import {
  assertSearchEvaluationResult,
  assertSearchEvaluationRun,
  type SearchEvaluationCase,
  type SearchEvaluationResult,
  type SearchEvaluationRun,
} from "@lervo/search";

import { prepareObservationSubdirectory, writeObservation } from "./observation-files.js";

export class LocalSearchEvaluationStore {
  private constructor(
    private readonly resultsPath: string,
    private readonly runsPath: string,
  ) {}

  static async open(repositoryRoot: string): Promise<LocalSearchEvaluationStore> {
    const [resultsPath, runsPath] = await Promise.all([
      prepareObservationSubdirectory(repositoryRoot, "evaluation-results"),
      prepareObservationSubdirectory(repositoryRoot, "evaluation-runs"),
    ]);
    return new LocalSearchEvaluationStore(resultsPath, runsPath);
  }

  async record(input: {
    cases: readonly SearchEvaluationCase[];
    results: readonly SearchEvaluationResult[];
    run: SearchEvaluationRun;
  }): Promise<void> {
    assertSearchEvaluationRun(input.run, input.cases, input.results);
    for (const [index, result] of input.results.entries()) {
      assertSearchEvaluationResult(result, input.cases[index]);
      await writeObservation(resolve(this.resultsPath, `${result.resultId}.json`), result);
    }
    await writeObservation(resolve(this.runsPath, `${input.run.runId}.json`), input.run);
  }
}
