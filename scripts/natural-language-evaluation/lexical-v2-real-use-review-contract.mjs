import { existsSync } from "node:fs";
import { resolve } from "node:path";

const approvalId = "wapr_ab432bcd3e9591b7";
const bindingHash = "sha256:ab432bcd3e9591b7dd94879ca6e8e7a314b4d6c7ae2cead153bf61512667be1d";
const requiredCaseIds = [
  "actual_cross_provider_quality",
  "actual_external_engine_extensibility",
  "actual_no_gate_weakening",
  "actual_raise_v2_to_pass",
];

function object(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function exactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new TypeError(`${label} contains unsupported or missing fields.`);
  }
}

export function validateLexicalV2RealUseReview(value, repositoryRoot) {
  const suite = object(value, "lexical-v2 real-use review");
  exactKeys(
    suite,
    [
      "schemaVersion",
      "suiteId",
      "publicQueries",
      "queryVisibility",
      "telemetryQueryText",
      "provenance",
      "review",
      "cases",
    ],
    "lexical-v2 real-use review",
  );
  const review = object(suite.review, "lexical-v2 real-use review approval");
  exactKeys(
    review,
    ["approvalId", "bindingHash", "status", "caseRetention"],
    "lexical-v2 real-use review approval",
  );
  if (
    suite.schemaVersion !== 1 ||
    suite.suiteId !== "spbench_lexical_v2_real_use_reviewed.v1" ||
    suite.publicQueries !== false ||
    suite.queryVisibility !== "repository_owner_readable" ||
    suite.telemetryQueryText !== "excluded" ||
    suite.provenance !== "human_reviewed" ||
    review.approvalId !== approvalId ||
    review.bindingHash !== bindingHash ||
    review.status !== "accepted_by_user_reply" ||
    review.caseRetention !== "retain_all_without_replacement"
  ) {
    throw new TypeError("The lexical-v2 real-use review authority or privacy contract changed.");
  }
  if (!Array.isArray(suite.cases) || suite.cases.length !== requiredCaseIds.length) {
    throw new TypeError("The approved lexical-v2 real-use case set must retain all four cases.");
  }
  const seen = new Set();
  for (const source of suite.cases) {
    const item = object(source, "lexical-v2 real-use case");
    exactKeys(
      item,
      ["caseId", "contextRequirement", "query", "expectedPaths", "maximumRank", "matchPolicy"],
      "lexical-v2 real-use case",
    );
    if (
      !requiredCaseIds.includes(item.caseId) ||
      seen.has(item.caseId) ||
      !["none", "current_workstream"].includes(item.contextRequirement) ||
      typeof item.query !== "string" ||
      item.query.length < 1 ||
      item.query.length > 500 ||
      item.maximumRank !== 10 ||
      item.matchPolicy !== "all" ||
      !Array.isArray(item.expectedPaths) ||
      item.expectedPaths.length < 1 ||
      item.expectedPaths.length > 2 ||
      new Set(item.expectedPaths).size !== item.expectedPaths.length
    ) {
      throw new TypeError("An approved lexical-v2 real-use case is invalid.");
    }
    for (const path of item.expectedPaths) {
      if (
        typeof path !== "string" ||
        path.startsWith("/") ||
        path.includes("..") ||
        !existsSync(resolve(repositoryRoot, path))
      ) {
        throw new TypeError(`An approved lexical-v2 expected path is unavailable: ${path}`);
      }
    }
    seen.add(item.caseId);
  }
  if (JSON.stringify([...seen].sort()) !== JSON.stringify(requiredCaseIds)) {
    throw new TypeError("The approved lexical-v2 real-use case identity set changed.");
  }
  return structuredClone(suite);
}
