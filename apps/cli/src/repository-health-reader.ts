import { readRepositoryFile } from "@lervo/context";
import type { RepositoryHealthProjectionV1 } from "@lervo/application-contract";
import { unknownHealthMeasure, unknownRepositoryHealth } from "./repository-health-measure.js";
export { unknownHealthMeasure, unknownRepositoryHealth } from "./repository-health-measure.js";
import { validHealthProjection } from "./repository-health-validation.js";
import { inspectKnowledgeResidentHealth } from "@lervo/repository-knowledge-runtime";
import { expireHealthFreshness } from "./repository-health-freshness.js";

export const REPOSITORY_HEALTH_PATH = ".lervo/state/repository-health.json";
export const MAXIMUM_HEALTH_FILE_BYTES = 64 * 1024;
export const HEALTH_MAXIMUM_AGE_MS = 20 * 60_000;
export const HEALTH_MEASURES = [
  "convergence",
  "longestStop",
  "freshness",
  "ownerReview",
  "deferred",
  "brokenLinks",
  "find",
] as const;

/** Bounded projection and live heartbeat reads; no event scan, provider, lint or repair. */
export async function readRepositoryHealth(input: {
  root: string;
  repositoryRevision: string;
  now: Date;
  /**
   * Terminal turns keep a projection made before the latest repository change, within the same
   * age window, instead of hiding every measure; the formatter labels it. Attention stays exact.
   */
  acceptEarlierRevision?: boolean;
}): Promise<RepositoryHealthProjectionV1> {
  const fallback = (reason: string) =>
    unknownRepositoryHealth(input.repositoryRevision, input.now, reason);
  try {
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        await readRepositoryFile(input.root, REPOSITORY_HEALTH_PATH, MAXIMUM_HEALTH_FILE_BYTES),
      ),
    ) as RepositoryHealthProjectionV1;
    if (!validHealthProjection(value)) return fallback("projection_invalid");
    if (value.repositoryRevision !== input.repositoryRevision && input.acceptEarlierRevision !== true) {
      const result = fallback("projection_revision_changed");
      result.observedAt = value.observedAt;
      return result;
    }
    const age = input.now.getTime() - Date.parse(value.observedAt);
    if (age < 0 || age > HEALTH_MAXIMUM_AGE_MS) {
      const result = fallback(age < 0 ? "projection_clock_skew" : "projection_stale");
      result.observedAt = value.observedAt;
      return result;
    }
    for (const key of HEALTH_MEASURES) {
      const measure = value.measures[key];
      if (key === "freshness") {
        value.measures.freshness = expireHealthFreshness(value.measures.freshness, input.now);
        continue;
      }
      if (key === "convergence" && value.measures.convergence.value !== null) {
        const convergence = value.measures.convergence;
        const live = await inspectKnowledgeResidentHealth(input.root, input.now).catch(() => null);
        const heartbeatAge = input.now.getTime() - Date.parse(live?.heartbeatAt ?? "");
        if (
          live === null ||
          !Number.isFinite(heartbeatAge) ||
          heartbeatAge < 0 ||
          heartbeatAge > 120_000 ||
          live.state !== convergence.value!.residentState
        ) {
          value.measures.convergence = unknownHealthMeasure(
            "resident_observation_stale_or_changed",
            convergence.source,
          );
          continue;
        }
        convergence.validUntil = new Date(
          Math.min(
            Date.parse(convergence.observedAt!) + HEALTH_MAXIMUM_AGE_MS,
            Date.parse(live.heartbeatAt!) + 120_000,
          ),
        ).toISOString();
      }
      if (
        measure.status !== "unknown" &&
        (Date.parse(measure.observedAt!) > input.now.getTime() ||
          Date.parse(measure.validUntil!) < input.now.getTime())
      )
        value.measures[key] = unknownHealthMeasure("source_stale", measure.source);
    }
    return value;
  } catch {
    return fallback("projection_missing_or_unreadable");
  }
}
