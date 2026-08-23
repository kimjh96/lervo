import type {
  EnvironmentObservation,
  EnvironmentResolution,
  EnvironmentResolutionCandidate,
  EnvironmentTargetManifest,
} from "./types.js";
import { validateEnvironmentTargetManifest } from "./validation.js";
import { validateEnvironmentObservation } from "./validation.js";

export function resolveEnvironmentTarget(input: {
  target: EnvironmentTargetManifest;
  observations: EnvironmentObservation[];
  at?: Date;
  additionalCapabilities?: string[];
}): EnvironmentResolution {
  const target = validateEnvironmentTargetManifest(input.target);
  const required = new Set([...target.requiredCapabilities, ...(input.additionalCapabilities ?? [])]);
  const at = (input.at ?? new Date()).getTime();
  const candidates: EnvironmentResolutionCandidate[] = [];
  for (const observationValue of input.observations) {
    const observation = validateEnvironmentObservation(observationValue);
    if (observation.status !== "available" || Date.parse(observation.validUntil) <= at ||
      observation.verification.some((verification) => verification.status !== "verified")) continue;
    for (const subject of observation.subjects) {
      if ([...required].some((capability) => !subject.capabilities.includes(capability))) continue;
      if (target.selectors.some((selector) => subject.labels[selector.label] !== selector.equals)) continue;
      candidates.push({ sourceId: observation.sourceId, subject, observedAt: observation.observedAt });
    }
  }
  if (candidates.length === 0) return { status: "unresolved", targetId: target.targetId, reason: "no_fresh_verified_match" };
  const preference = new Map(target.preferredSourceIds.map((sourceId, index) => [sourceId, index]));
  candidates.sort((left, right) =>
    (preference.get(left.sourceId) ?? Number.MAX_SAFE_INTEGER) - (preference.get(right.sourceId) ?? Number.MAX_SAFE_INTEGER) ||
    right.observedAt.localeCompare(left.observedAt) || left.sourceId.localeCompare(right.sourceId) ||
    left.subject.subjectId.localeCompare(right.subject.subjectId));
  const bestPreference = preference.get(candidates[0]!.sourceId) ?? Number.MAX_SAFE_INTEGER;
  const bestTime = candidates[0]!.observedAt;
  const tied = candidates.filter((candidate) =>
    (preference.get(candidate.sourceId) ?? Number.MAX_SAFE_INTEGER) === bestPreference && candidate.observedAt === bestTime);
  return tied.length === 1
    ? { status: "resolved", targetId: target.targetId, candidate: tied[0]! }
    : { status: "ambiguous", targetId: target.targetId, candidates: tied };
}
