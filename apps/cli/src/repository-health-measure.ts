import type {
  RepositoryHealthMeasureV1,
  RepositoryHealthProjectionV1,
} from "@lervo/application-contract";

export function unknownHealthMeasure<T>(
  reason: string,
  source: string[] = [".lervo/state/repository-health.json"],
): RepositoryHealthMeasureV1<T> {
  return {
    value: null,
    observedAt: null,
    source,
    coverage: "unknown",
    status: "unknown",
    reason,
    validUntil: null,
  };
}

export function unknownRepositoryHealth(
  revision: string,
  now: Date,
  reason: string,
): RepositoryHealthProjectionV1 {
  return {
    schemaVersion: 1,
    kind: "repository_health.projection",
    observedAt: now.toISOString(),
    repositoryRevision: revision,
    measures: {
      convergence: unknownHealthMeasure(reason),
      longestStop: unknownHealthMeasure(reason),
      freshness: unknownHealthMeasure(reason),
      ownerReview: unknownHealthMeasure(reason),
      deferred: unknownHealthMeasure(reason),
      brokenLinks: unknownHealthMeasure(reason),
      find: unknownHealthMeasure(reason),
    },
  };
}
