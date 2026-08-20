import { resolve } from "node:path";

import { assertSearchCandidateReview, type SearchCandidateReview } from "@lervo/search";

import { prepareObservationSubdirectory, writeObservation } from "./observation-files.js";

export class LocalSearchCandidateReviewStore {
  private constructor(private readonly reviewsPath: string) {}

  static async open(repositoryRoot: string): Promise<LocalSearchCandidateReviewStore> {
    return new LocalSearchCandidateReviewStore(
      await prepareObservationSubdirectory(repositoryRoot, "evaluation-reviews"),
    );
  }

  async record(review: SearchCandidateReview): Promise<void> {
    assertSearchCandidateReview(review);
    await writeObservation(resolve(this.reviewsPath, `${review.reviewId}.json`), review);
  }
}
