import {
  assertSearchAdapterBuildId,
  assertSearchEngineIdentity,
  sameSearchEngine,
  type SearchEvaluationEnginePort,
  type SearchEnginePort,
} from "./evaluation-engine.js";
import { SEARCH_ENGINE, SearchError, type SearchEngineIdentity } from "./types.js";

export const SEARCH_CANDIDATE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,7}$/;
export const SEARCH_MAX_CANDIDATE_ENGINES = 16;

export interface SearchEvaluationEngineRegistration {
  candidateId: string;
  engine: SearchEvaluationEnginePort;
}

export interface SearchEvaluationEngineRegistrationInfo {
  candidateId: string;
  engine: SearchEngineIdentity;
  adapterBuildId: string;
}

export interface SearchCandidateEngineResolver {
  resolve(candidateId: string): SearchEnginePort;
}

export class SearchEvaluationEngineRegistry implements SearchCandidateEngineResolver {
  private readonly engines = new Map<string, SearchEvaluationEnginePort>();
  private readonly registrations: SearchEvaluationEngineRegistrationInfo[];

  constructor(registrations: readonly SearchEvaluationEngineRegistration[]) {
    if (
      !Array.isArray(registrations) ||
      registrations.length < 1 ||
      registrations.length > SEARCH_MAX_CANDIDATE_ENGINES
    ) {
      throw new SearchError(
        "invalid_evaluation_engine",
        "The number of candidate search engines to register is invalid.",
      );
    }
    const coordinates = new Set<string>();
    const adapterBuildIds = new Set<string>();
    this.registrations = registrations
      .map(({ candidateId, engine }) => {
        assertSearchEngineIdentity(engine.engine);
        assertSearchAdapterBuildId(engine.adapterBuildId);
        const coordinate = `${engine.engine.id}:${engine.engine.version}`;
        if (
          !SEARCH_CANDIDATE_ID_PATTERN.test(candidateId) ||
          candidateId.length > 64 ||
          this.engines.has(candidateId) ||
          coordinates.has(coordinate) ||
          adapterBuildIds.has(engine.adapterBuildId) ||
          sameSearchEngine(engine.engine, SEARCH_ENGINE)
        ) {
          throw new SearchError(
            "invalid_evaluation_engine",
            "Candidate search ID or engine coordinates are duplicated or invalid.",
          );
        }
        this.engines.set(candidateId, engine);
        coordinates.add(coordinate);
        adapterBuildIds.add(engine.adapterBuildId);
        return { candidateId, engine: { ...engine.engine }, adapterBuildId: engine.adapterBuildId };
      })
      .sort((left, right) =>
        left.candidateId < right.candidateId ? -1 : left.candidateId > right.candidateId ? 1 : 0,
      );
  }

  list(): SearchEvaluationEngineRegistrationInfo[] {
    return structuredClone(this.registrations);
  }

  resolve(candidateId: string): SearchEvaluationEnginePort {
    const engine = this.engines.get(candidateId);
    if (engine === undefined) {
      throw new SearchError(
        "evaluation_candidate_not_registered",
        "The candidate search engine is not registered.",
      );
    }
    return engine;
  }

  resolveEngine(identity: SearchEngineIdentity): SearchEvaluationEngineRegistration {
    assertSearchEngineIdentity(identity);
    const registration = this.registrations.find((item) => sameSearchEngine(item.engine, identity));
    if (registration === undefined) {
      throw new SearchError(
        "evaluation_candidate_not_registered",
        "The candidate search engine is not registered.",
      );
    }
    return {
      candidateId: registration.candidateId,
      engine: this.engines.get(registration.candidateId)!,
    };
  }
}
