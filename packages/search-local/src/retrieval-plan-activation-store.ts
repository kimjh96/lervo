import { resolve } from "node:path";

import {
  assertSearchRetrievalPlanActivation,
  type SearchRetrievalPlanActivation,
} from "@lervo/search";

import {
  existingObservationSubdirectory,
  listObservations,
  prepareObservationSubdirectory,
  writeObservation,
} from "./observation-files.js";
import { SearchLocalError } from "./types.js";

const MAXIMUM_ACTIVATIONS = 256;
const ACTIVATION_FILE = /^(?:baseline|srpact_[a-f0-9]{24})\.json$/;

export async function loadSearchRetrievalPlanActivationHistory(
  repositoryRoot: string,
): Promise<SearchRetrievalPlanActivation[]> {
  const directory = await existingObservationSubdirectory(
    repositoryRoot,
    "retrieval-plan-selections",
  );
  if (directory === null) return [];
  const records = await listObservations<SearchRetrievalPlanActivation>({
    path: directory,
    pattern: ACTIVATION_FILE,
    assertValue: assertSearchRetrievalPlanActivation,
    expectedFileName: (activation) => `${activation.previousActivationId ?? "baseline"}.json`,
  });
  if (records.length > MAXIMUM_ACTIVATIONS) {
    throw new SearchLocalError(
      "observation_limit_exceeded",
      "The number of retrieval-plan selection transitions exceeds 256.",
    );
  }
  const byPrevious = new Map(records.map((item) => [item.previousActivationId, item]));
  const ordered: SearchRetrievalPlanActivation[] = [];
  let previous: SearchRetrievalPlanActivation | null = null;
  while (true) {
    const next = byPrevious.get(previous?.activationId ?? null);
    if (next === undefined) break;
    assertSearchRetrievalPlanActivation(next, previous);
    ordered.push(next);
    previous = next;
  }
  if (ordered.length !== records.length) {
    throw new SearchLocalError(
      "observation_invalid",
      "The retrieval-plan selections do not form one continuous chain.",
    );
  }
  return ordered;
}

export async function loadCurrentSearchRetrievalPlanActivation(
  repositoryRoot: string,
): Promise<SearchRetrievalPlanActivation | null> {
  return (await loadSearchRetrievalPlanActivationHistory(repositoryRoot)).at(-1) ?? null;
}

export async function recordSearchRetrievalPlanActivation(
  repositoryRoot: string,
  activation: SearchRetrievalPlanActivation,
): Promise<void> {
  const current = await loadCurrentSearchRetrievalPlanActivation(repositoryRoot);
  assertSearchRetrievalPlanActivation(activation, current);
  const directory = await prepareObservationSubdirectory(
    repositoryRoot,
    "retrieval-plan-selections",
  );
  try {
    await writeObservation(
      resolve(directory, `${activation.previousActivationId ?? "baseline"}.json`),
      activation,
    );
  } catch (error) {
    if ((error as { code?: unknown }).code === "observation_conflict") {
      throw new SearchLocalError(
        "retrieval_plan_activation_conflict",
        "Another retrieval-plan transition already started from the same selection.",
      );
    }
    throw error;
  }
}
