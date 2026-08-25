import { resolve } from "node:path";

import {
  assertSearchCandidateReview,
  SEARCH_CANDIDATE_REVIEW_PATTERN,
  type SearchCandidateReview,
} from "@lervo/search";

import {
  existingObservationSubdirectory,
  prepareObservationSubdirectory,
  readObservation,
  writeObservation,
} from "./observation-files.js";
import { SearchLocalError } from "./types.js";

export async function loadStoredSearchCandidateReview(
  repositoryRoot: string,
  reviewId: string,
): Promise<SearchCandidateReview> {
  if (!SEARCH_CANDIDATE_REVIEW_PATTERN.test(reviewId)) {
    throw new SearchLocalError(
      "candidate_review_not_found",
      "The search candidate review ID is invalid.",
    );
  }
  const directory = await existingObservationSubdirectory(repositoryRoot, "evaluation-reviews");
  if (directory === null) {
    throw new SearchLocalError(
      "candidate_review_not_found",
      "The search candidate review source was not found.",
    );
  }
  let review: SearchCandidateReview;
  try {
    review = await readObservation<SearchCandidateReview>(resolve(directory, `${reviewId}.json`));
  } catch (error) {
    if (
      error instanceof SearchLocalError &&
      error.code === "observation_read_failed" &&
      (error.cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
    ) {
      throw new SearchLocalError(
        "candidate_review_not_found",
        "The search candidate review source was not found.",
      );
    }
    throw error;
  }
  assertSearchCandidateReview(review);
  if (review.reviewId !== reviewId) {
    throw new SearchLocalError(
      "observation_invalid",
      "The search candidate review ID does not match the file coordinates.",
    );
  }
  return review;
}

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
