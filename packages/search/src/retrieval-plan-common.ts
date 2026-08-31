import { SearchError } from "./types.js";

export const PLAN_ID_PATTERN = /^srplan_[a-f0-9]{24}$/;
export const REVIEW_ID_PATTERN = /^srprev_[a-f0-9]{24}$/;
export const POLICY_ID_PATTERN = /^srppol_[a-f0-9]{24}$/;
export const BUNDLE_ID_PATTERN = /^srpbundle_[a-f0-9]{24}$/;
export const ACTIVATION_ID_PATTERN = /^srpact_[a-f0-9]{24}$/;
export const POPULATION_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,7}$/;
export const ACTOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function invalidRetrievalPlan(message: string): never {
  throw new SearchError("invalid_retrieval_plan", message);
}

export function assertRetrievalPlanTimestamp(value: string): void {
  if (new Date(value).toISOString() !== value)
    invalidRetrievalPlan("A retrieval-plan timestamp is invalid.");
}

export function assertUniqueRetrievalPlanIds(
  values: readonly string[],
  pattern: RegExp,
  label: string,
): void {
  if (
    values.length < 1 ||
    values.length > 16 ||
    new Set(values).size !== values.length ||
    values.some((value) => !pattern.test(value))
  ) {
    invalidRetrievalPlan(`The retrieval-plan ${label} allowlist is invalid.`);
  }
}
