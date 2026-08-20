import { resolve } from "node:path";

import {
  assertSearchAssessment,
  assertSearchAttempt,
  type SearchAssessment,
  type SearchAttempt,
} from "@lervo/search";

import {
  existingObservationDirectories,
  listObservations,
  prepareObservationDirectories,
  readObservation,
  writeObservation,
} from "./observation-files.js";
import { SearchLocalError } from "./types.js";

const ATTEMPT_FILE = /^sat_[a-f0-9]{24}\.json$/;

export class LocalSearchObservationStore {
  private constructor(
    private readonly attemptsPath: string,
    private readonly assessmentsPath: string,
  ) {}

  static async open(repositoryRoot: string): Promise<LocalSearchObservationStore> {
    const paths = await prepareObservationDirectories(repositoryRoot);
    return new LocalSearchObservationStore(paths.attempts, paths.assessments);
  }

  static async openExisting(repositoryRoot: string): Promise<LocalSearchObservationStore | null> {
    const paths = await existingObservationDirectories(repositoryRoot);
    return paths === null ? null : new LocalSearchObservationStore(paths.attempts, paths.assessments);
  }

  async recordAttempt(attempt: SearchAttempt): Promise<void> {
    assertSearchAttempt(attempt);
    await writeObservation(resolve(this.attemptsPath, `${attempt.attemptId}.json`), attempt);
  }

  async readAttempt(attemptId: string): Promise<SearchAttempt> {
    if (!/^sat_[a-f0-9]{24}$/.test(attemptId)) {
      throw new SearchLocalError("observation_invalid", "검색 시도 ID가 유효하지 않습니다.");
    }
    const attempt = await readObservation<SearchAttempt>(resolve(this.attemptsPath, `${attemptId}.json`));
    assertSearchAttempt(attempt);
    if (attempt.attemptId !== attemptId) {
      throw new SearchLocalError("observation_invalid", "검색 시도 파일명과 원본 ID가 다릅니다.");
    }
    return attempt;
  }

  async recordAssessment(assessment: SearchAssessment): Promise<void> {
    assertSearchAssessment(assessment, await this.readAttempt(assessment.attemptId));
    await writeObservation(resolve(this.assessmentsPath, `${assessment.attemptId}.json`), assessment);
  }

  async readAssessment(attemptId: string): Promise<SearchAssessment> {
    const attempt = await this.readAttempt(attemptId);
    const assessment = await readObservation<SearchAssessment>(resolve(this.assessmentsPath, `${attemptId}.json`));
    assertSearchAssessment(assessment, attempt);
    if (assessment.attemptId !== attemptId) {
      throw new SearchLocalError("observation_invalid", "검색 평가 파일명과 대상 시도 ID가 다릅니다.");
    }
    return assessment;
  }

  async listAttempts(): Promise<SearchAttempt[]> {
    return listObservations({
      path: this.attemptsPath,
      pattern: ATTEMPT_FILE,
      assertValue: assertSearchAttempt,
      expectedFileName: (attempt) => `${attempt.attemptId}.json`,
    });
  }

  async listAssessments(): Promise<SearchAssessment[]> {
    return listObservations({
      path: this.assessmentsPath,
      pattern: ATTEMPT_FILE,
      assertValue: assertSearchAssessment,
      expectedFileName: (assessment) => `${assessment.attemptId}.json`,
    });
  }
}
