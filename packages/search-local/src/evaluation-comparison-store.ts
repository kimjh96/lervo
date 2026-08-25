import { resolve } from "node:path";

import {
  assertSearchEvaluationComparison,
  type SearchEvaluationComparison,
  type SearchEvaluationComparisonEvidence,
} from "@lervo/search";

import { prepareObservationSubdirectory, writeObservation } from "./observation-files.js";

export class LocalSearchEvaluationComparisonStore {
  private constructor(private readonly comparisonsPath: string) {}

  static async open(repositoryRoot: string): Promise<LocalSearchEvaluationComparisonStore> {
    return new LocalSearchEvaluationComparisonStore(
      await prepareObservationSubdirectory(repositoryRoot, "evaluation-comparisons"),
    );
  }

  async record(
    comparison: SearchEvaluationComparison,
    evidence: SearchEvaluationComparisonEvidence,
  ): Promise<void> {
    assertSearchEvaluationComparison(comparison, evidence);
    await writeObservation(
      resolve(this.comparisonsPath, `${comparison.comparisonId}.json`),
      comparison,
    );
  }
}
