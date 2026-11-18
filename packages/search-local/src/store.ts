import { resolve } from "node:path";

import { assertSearchAttempt, type SearchAttempt } from "@lervo/search";

import { prepareObservationSubdirectory, writeObservation } from "./observation-files.js";

/** Records search attempts; assessments were removed with search evaluation by ADR-0560. */
export class LocalSearchObservationStore {
  private constructor(private readonly attemptsPath: string) {}

  static async open(repositoryRoot: string): Promise<LocalSearchObservationStore> {
    return new LocalSearchObservationStore(
      await prepareObservationSubdirectory(repositoryRoot, "attempts"),
    );
  }

  async recordAttempt(attempt: SearchAttempt): Promise<void> {
    assertSearchAttempt(attempt);
    await writeObservation(resolve(this.attemptsPath, `${attempt.attemptId}.json`), attempt);
  }
}
