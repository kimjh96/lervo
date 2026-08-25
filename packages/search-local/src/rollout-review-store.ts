import { resolve } from "node:path";

import {
  assertSearchRolloutReview,
  SEARCH_ROLLOUT_REVIEW_PATTERN,
  type SearchRolloutReview,
} from "@lervo/search";

import {
  existingObservationSubdirectory,
  listObservations,
  prepareObservationSubdirectory,
  writeObservation,
  readObservation,
} from "./observation-files.js";
import { SearchLocalError } from "./types.js";

const MAX_ROLLOUT_REVIEWS = 256;
const ROLLOUT_REVIEW_FILE = /^srrv_[a-f0-9]{24}\.json$/;

export async function loadStoredSearchRolloutReview(
  repositoryRoot: string,
  rolloutReviewId: string,
): Promise<SearchRolloutReview> {
  if (!SEARCH_ROLLOUT_REVIEW_PATTERN.test(rolloutReviewId)) {
    throw new SearchLocalError(
      "rollout_review_not_found",
      "The search rollout review ID is invalid.",
    );
  }
  const directory = await existingObservationSubdirectory(repositoryRoot, "rollout-reviews");
  if (directory === null) {
    throw new SearchLocalError(
      "rollout_review_not_found",
      "The search rollout review source was not found.",
    );
  }
  try {
    const review = await readObservation<SearchRolloutReview>(
      resolve(directory, `${rolloutReviewId}.json`),
    );
    assertSearchRolloutReview(review);
    if (review.rolloutReviewId !== rolloutReviewId) {
      throw new SearchLocalError(
        "observation_invalid",
        "The search rollout review ID does not match the file coordinates.",
      );
    }
    return review;
  } catch (error) {
    if (
      error instanceof SearchLocalError &&
      error.code === "observation_read_failed" &&
      (error.cause as NodeJS.ErrnoException | undefined)?.code === "ENOENT"
    ) {
      throw new SearchLocalError(
        "rollout_review_not_found",
        "The search rollout review source was not found.",
      );
    }
    throw error;
  }
}

export async function listStoredSearchRolloutReviews(
  repositoryRoot: string,
): Promise<SearchRolloutReview[]> {
  const directory = await existingObservationSubdirectory(repositoryRoot, "rollout-reviews");
  if (directory === null) return [];
  const reviews = await listObservations<SearchRolloutReview>({
    path: directory,
    pattern: ROLLOUT_REVIEW_FILE,
    assertValue: assertSearchRolloutReview,
    expectedFileName: (review) => `${review.rolloutReviewId}.json`,
  });
  if (reviews.length > MAX_ROLLOUT_REVIEWS) {
    throw new SearchLocalError(
      "observation_limit_exceeded",
      "The number of search rollout review sources exceeds 256.",
    );
  }
  return reviews;
}

export async function recordSearchRolloutReview(
  repositoryRoot: string,
  review: SearchRolloutReview,
): Promise<void> {
  assertSearchRolloutReview(review);
  const existing = await listStoredSearchRolloutReviews(repositoryRoot);
  if (
    existing.length >= MAX_ROLLOUT_REVIEWS &&
    !existing.some((item) => item.rolloutReviewId === review.rolloutReviewId)
  ) {
    throw new SearchLocalError(
      "observation_limit_exceeded",
      "The number of search rollout review sources exceeds 256.",
    );
  }
  const directory = await prepareObservationSubdirectory(repositoryRoot, "rollout-reviews");
  await writeObservation(resolve(directory, `${review.rolloutReviewId}.json`), review);
}
