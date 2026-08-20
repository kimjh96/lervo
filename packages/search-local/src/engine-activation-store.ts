import { resolve } from "node:path";

import {
  assertSearchEngineActivation,
  SEARCH_ENGINE_ACTIVATION_PATTERN,
  type SearchEngineActivation,
} from "@lervo/search";

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
    throw new SearchLocalError("observation_limit_exceeded", "검색 엔진 선택 전이가 256개를 넘었습니다.");
  }
  const byPrevious = new Map(activations.map((activation) => [activation.previousActivationId, activation]));
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
    throw new SearchLocalError("observation_invalid", "검색 엔진 선택 전이가 하나의 연속 chain이 아닙니다.");
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
      throw new SearchLocalError("engine_activation_conflict", "같은 이전 선택에서 다른 활성화가 이미 시작되었습니다.");
    }
    throw error;
  }
}
