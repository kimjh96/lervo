import { resolve } from "node:path";

import { assertSearchEngineActivation, type SearchEngineActivation } from "@lervo/search";

import {
  existingObservationSubdirectory,
  listObservations,
  prepareObservationSubdirectory,
  writeObservation,
} from "./observation-files.js";
import { SearchLocalError } from "./types.js";

const MAX_ACTIVATIONS = 256;
const ACTIVATION_LINK_FILE = /^(?:baseline|seact_[a-f0-9]{24})\.json$/;

export async function loadSearchEngineActivationHistory(
  repositoryRoot: string,
): Promise<SearchEngineActivation[]> {
  const directory = await existingObservationSubdirectory(repositoryRoot, "engine-selections");
  if (directory === null) return [];
  const activations = await listObservations<SearchEngineActivation>({
    path: directory,
    pattern: ACTIVATION_LINK_FILE,
    assertValue: assertSearchEngineActivation,
    expectedFileName: (activation) => `${activation.previousActivationId ?? "baseline"}.json`,
  });
  if (activations.length > MAX_ACTIVATIONS) {
    throw new SearchLocalError(
      "observation_limit_exceeded",
      "The number of search engine selection transitions exceeds 256.",
    );
  }
  const byPrevious = new Map(
    activations.map((activation) => [activation.previousActivationId, activation]),
  );
  const ordered: SearchEngineActivation[] = [];
  let previous: SearchEngineActivation | null = null;
  while (true) {
    const next = byPrevious.get(previous?.activationId ?? null);
    if (next === undefined) break;
    assertSearchEngineActivation(next, previous);
    ordered.push(next);
    previous = next;
  }
  if (ordered.length !== activations.length) {
    throw new SearchLocalError(
      "observation_invalid",
      "The search engine selection transitions do not form one continuous chain.",
    );
  }
  return ordered;
}

export async function loadCurrentSearchEngineActivation(
  repositoryRoot: string,
): Promise<SearchEngineActivation | null> {
  return (await loadSearchEngineActivationHistory(repositoryRoot)).at(-1) ?? null;
}

export async function recordSearchEngineActivation(
  repositoryRoot: string,
  activation: SearchEngineActivation,
): Promise<void> {
  const current = await loadCurrentSearchEngineActivation(repositoryRoot);
  assertSearchEngineActivation(activation, current);
  const directory = await prepareObservationSubdirectory(repositoryRoot, "engine-selections");
  const path = resolve(directory, `${activation.previousActivationId ?? "baseline"}.json`);
  try {
    await writeObservation(path, activation);
  } catch (error) {
    if ((error as { code?: unknown }).code === "observation_conflict") {
      throw new SearchLocalError(
        "engine_activation_conflict",
        "Another activation has already started from the same previous selection.",
      );
    }
    throw error;
  }
}
