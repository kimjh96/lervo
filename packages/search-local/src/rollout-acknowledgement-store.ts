import { resolve } from "node:path";

import {
  assertSearchRolloutKeepAcknowledgement,
  type SearchRolloutKeepAcknowledgement,
} from "@lervo/search";

import {
  existingObservationSubdirectory,
  listObservations,
  prepareObservationSubdirectory,
  writeObservation,
} from "./observation-files.js";
import { SearchLocalError } from "./types.js";

const MAX_ACKNOWLEDGEMENTS = 256;
const ACKNOWLEDGEMENT_FILE = /^srack_[a-f0-9]{24}\.json$/;

export async function listStoredSearchRolloutKeepAcknowledgements(
  repositoryRoot: string,
): Promise<SearchRolloutKeepAcknowledgement[]> {
  const directory = await existingObservationSubdirectory(
    repositoryRoot,
    "rollout-acknowledgements",
  );
  if (directory === null) return [];
  const values = await listObservations<SearchRolloutKeepAcknowledgement>({
    path: directory,
    pattern: ACKNOWLEDGEMENT_FILE,
    assertValue: assertSearchRolloutKeepAcknowledgement,
    expectedFileName: (value) => `${value.acknowledgementId}.json`,
  });
  if (values.length > MAX_ACKNOWLEDGEMENTS) {
    throw new SearchLocalError(
      "observation_limit_exceeded",
      "The number of search rollout candidate-retention acknowledgements exceeds 256.",
    );
  }
  return values;
}

export async function recordSearchRolloutKeepAcknowledgement(
  repositoryRoot: string,
  acknowledgement: SearchRolloutKeepAcknowledgement,
): Promise<void> {
  assertSearchRolloutKeepAcknowledgement(acknowledgement);
  const existing = await listStoredSearchRolloutKeepAcknowledgements(repositoryRoot);
  if (
    existing.length >= MAX_ACKNOWLEDGEMENTS &&
    !existing.some((item) => item.acknowledgementId === acknowledgement.acknowledgementId)
  ) {
    throw new SearchLocalError(
      "observation_limit_exceeded",
      "The number of search rollout candidate-retention acknowledgements exceeds 256.",
    );
  }
  const directory = await prepareObservationSubdirectory(
    repositoryRoot,
    "rollout-acknowledgements",
  );
  await writeObservation(
    resolve(directory, `${acknowledgement.acknowledgementId}.json`),
    acknowledgement,
  );
}
