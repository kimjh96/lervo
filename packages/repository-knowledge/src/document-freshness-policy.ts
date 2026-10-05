import {
  defaultDocumentFreshnessPolicy,
  type DocumentFreshnessPolicy,
} from "./document-freshness-contract.js";

/** The optional `documentFreshness` section of `.lervo/knowledge/policy.yaml`. */
export type DocumentFreshnessPolicySection = Partial<DocumentFreshnessPolicy>;

const keys = new Set(Object.keys(defaultDocumentFreshnessPolicy));

function boundedInteger(value: unknown, minimum: number, maximum: number): boolean {
  return (
    Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
  );
}

function relativeRoot(value: unknown): boolean {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/u.test(value) &&
    !value.split("/").includes("..") &&
    !value.startsWith(".lervo")
  );
}

/** Each present key must hold a value inside its documented bound; absent keys keep defaults. */
export function documentFreshnessPolicySectionValid(value: unknown): boolean {
  if (value === undefined) return true;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const section = value as Record<string, unknown>;
  if (!Object.keys(section).every((key) => keys.has(key))) return false;
  const checks: Array<[string, (item: unknown) => boolean]> = [
    ["enabled", (item) => typeof item === "boolean"],
    [
      "safetyPatterns",
      (item) =>
        Array.isArray(item) &&
        item.length <= 64 &&
        item.every(
          (pattern) => typeof pattern === "string" && /^[a-z][a-z0-9_-]{1,31}$/u.test(pattern),
        ),
    ],
    ["maximumCandidatesPerCycle", (item) => boundedInteger(item, 1, 32)],
    ["maximumTokensPerCandidate", (item) => boundedInteger(item, 1_000, 200_000)],
    ["maximumTokensPerDay", (item) => boundedInteger(item, 1_000, 5_000_000)],
    [
      "maximumEditRatio",
      (item) => typeof item === "number" && Number.isFinite(item) && item > 0 && item <= 1,
    ],
    ["maximumEditBytes", (item) => boundedInteger(item, 64, 65_536)],
    ["historicalRoot", relativeRoot],
    ["holdDays", (item) => boundedInteger(item, 1, 365)],
    [
      "crossCheck",
      (item) => item === "required_for_consequential" || item === "always" || item === "never",
    ],
  ];
  return checks.every(([key, valid]) => section[key] === undefined || valid(section[key]));
}

/** The effective freshness policy: the section's keys over the defaults. */
export function documentFreshnessPolicy(policy: {
  documentFreshness?: DocumentFreshnessPolicySection;
}): DocumentFreshnessPolicy {
  return {
    ...defaultDocumentFreshnessPolicy,
    ...(policy.documentFreshness ?? {}),
    safetyPatterns: [
      ...(policy.documentFreshness?.safetyPatterns ??
        defaultDocumentFreshnessPolicy.safetyPatterns),
    ],
  };
}
