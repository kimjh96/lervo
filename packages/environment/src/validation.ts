import { EnvironmentError, type EnvironmentErrorCode } from "./errors.js";
import type {
  EnvironmentAdmissionPolicy,
  EnvironmentObservation,
  EnvironmentSourceManifest,
  EnvironmentTargetManifest,
  JsonValue,
} from "./types.js";

const IDENTIFIER = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+){0,7}$/;
const SOURCE_ID = /^src_[a-z0-9][a-z0-9_-]{7,63}$/;
const TARGET_ID = /^tgt_[a-z0-9][a-z0-9_-]{7,63}$/;
const SUBJECT_ID = /^sub_[a-f0-9]{24}$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function fail(code: EnvironmentErrorCode, message: string): never {
  throw new EnvironmentError(code, message);
}

function record(
  value: unknown,
  code: EnvironmentErrorCode,
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    fail(code, `${label} must be an object.`);
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: string[],
  code: EnvironmentErrorCode,
  label: string,
): void {
  const unexpected = Object.keys(value).filter((key) => !expected.includes(key));
  if (unexpected.length > 0)
    fail(code, `${label} contains unknown fields: ${unexpected.join(", ")}`);
}

function stringValue(
  value: unknown,
  code: EnvironmentErrorCode,
  label: string,
  pattern = IDENTIFIER,
): string {
  if (typeof value !== "string" || !pattern.test(value)) fail(code, `${label} value is invalid.`);
  return value;
}

function stringArray(
  value: unknown,
  code: EnvironmentErrorCode,
  label: string,
  maximum = 32,
  pattern = IDENTIFIER,
): string[] {
  if (!Array.isArray(value) || value.length > maximum)
    fail(code, `${label} must be an array of at most ${maximum} items.`);
  const values = value.map((item, index) => stringValue(item, code, `${label}[${index}]`, pattern));
  if (new Set(values).size !== values.length) fail(code, `${label} contains duplicate values.`);
  return values;
}

function jsonRecord(
  value: unknown,
  code: EnvironmentErrorCode,
  label: string,
): Record<string, JsonValue> {
  const result = record(value, code, label);
  try {
    const encoded = JSON.stringify(result);
    if (encoded === undefined || Buffer.byteLength(encoded) > 64 * 1024)
      fail(code, `${label} is too large.`);
  } catch {
    fail(code, `${label} must be a JSON value.`);
  }
  return result as Record<string, JsonValue>;
}

export function validateEnvironmentSourceManifest(value: unknown): EnvironmentSourceManifest {
  const code = "invalid_environment_source";
  const item = record(value, code, "environment source");
  exactKeys(
    item,
    [
      "schemaVersion",
      "sourceId",
      "adapterId",
      "scope",
      "capabilities",
      "maximumValiditySeconds",
      "sharing",
      "configuration",
    ],
    code,
    "environment source",
  );
  if (item.schemaVersion !== 1) fail(code, "Environment source schemaVersion must be 1.");
  const scope = item.scope;
  if (scope !== "project" && scope !== "user" && scope !== "organization")
    fail(code, "Environment source scope is invalid.");
  const sharing = item.sharing;
  if (sharing !== "local_only" && sharing !== "normalized_observations")
    fail(code, "Environment source sharing is invalid.");
  const maximumValiditySeconds = item.maximumValiditySeconds;
  if (
    !Number.isInteger(maximumValiditySeconds) ||
    (maximumValiditySeconds as number) < 30 ||
    (maximumValiditySeconds as number) > 86_400
  ) {
    fail(code, "maximumValiditySeconds must be an integer between 30 and 86400.");
  }
  return {
    schemaVersion: 1,
    sourceId: stringValue(item.sourceId, code, "sourceId", SOURCE_ID),
    adapterId: stringValue(item.adapterId, code, "adapterId"),
    scope,
    capabilities: stringArray(item.capabilities, code, "capabilities"),
    maximumValiditySeconds: maximumValiditySeconds as number,
    sharing,
    configuration: jsonRecord(item.configuration, code, "configuration"),
  };
}

export function validateEnvironmentTargetManifest(value: unknown): EnvironmentTargetManifest {
  const code = "invalid_environment_target";
  const item = record(value, code, "environment target");
  exactKeys(
    item,
    ["schemaVersion", "targetId", "requiredCapabilities", "selectors", "preferredSourceIds"],
    code,
    "environment target",
  );
  if (item.schemaVersion !== 1) fail(code, "Environment target schemaVersion must be 1.");
  if (!Array.isArray(item.selectors) || item.selectors.length > 16)
    fail(code, "selectors must be an array of at most 16 items.");
  const selectors = item.selectors.map((selector, index) => {
    const parsed = record(selector, code, `selectors[${index}]`);
    exactKeys(parsed, ["label", "equals"], code, `selectors[${index}]`);
    if (
      typeof parsed.equals !== "string" ||
      parsed.equals.length === 0 ||
      parsed.equals.length > 256
    )
      fail(code, `selectors[${index}].equals is invalid.`);
    return {
      label: stringValue(parsed.label, code, `selectors[${index}].label`),
      equals: parsed.equals,
    };
  });
  return {
    schemaVersion: 1,
    targetId: stringValue(item.targetId, code, "targetId", TARGET_ID),
    requiredCapabilities: stringArray(item.requiredCapabilities, code, "requiredCapabilities"),
    selectors,
    preferredSourceIds: stringArray(
      item.preferredSourceIds,
      code,
      "preferredSourceIds",
      32,
      SOURCE_ID,
    ),
  };
}

export function validateEnvironmentAdmissionPolicy(value: unknown): EnvironmentAdmissionPolicy {
  const code = "invalid_environment_policy";
  const item = record(value, code, "environment admission policy");
  exactKeys(
    item,
    ["schemaVersion", "defaultDecision", "rules"],
    code,
    "environment admission policy",
  );
  if (item.schemaVersion !== 1) fail(code, "Environment admission policy schemaVersion must be 1.");
  const decisions = ["auto_register", "review_required", "deny"] as const;
  if (!decisions.includes(item.defaultDecision as never)) fail(code, "defaultDecision is invalid.");
  if (!Array.isArray(item.rules) || item.rules.length > 64)
    fail(code, "rules must be an array of at most 64 items.");
  const rules = item.rules.map((rule, index) => {
    const parsed = record(rule, code, `rules[${index}]`);
    exactKeys(
      parsed,
      ["ruleId", "adapterId", "scopes", "capabilities", "decision"],
      code,
      `rules[${index}]`,
    );
    if (!decisions.includes(parsed.decision as never))
      fail(code, `rules[${index}].decision is invalid.`);
    let scopes;
    if (parsed.scopes !== undefined) {
      if (
        !Array.isArray(parsed.scopes) ||
        parsed.scopes.some(
          (scope) => scope !== "project" && scope !== "user" && scope !== "organization",
        )
      )
        fail(code, `rules[${index}].scopes is invalid.`);
      scopes = parsed.scopes as Array<"project" | "user" | "organization">;
    }
    return {
      ruleId: stringValue(parsed.ruleId, code, `rules[${index}].ruleId`),
      adapterId: stringValue(parsed.adapterId, code, `rules[${index}].adapterId`),
      ...(scopes === undefined ? {} : { scopes }),
      ...(parsed.capabilities === undefined
        ? {}
        : { capabilities: stringArray(parsed.capabilities, code, `rules[${index}].capabilities`) }),
      decision: parsed.decision as "auto_register" | "review_required" | "deny",
    };
  });
  if (new Set(rules.map((rule) => rule.ruleId)).size !== rules.length)
    fail(code, "ruleId is duplicated.");
  return {
    schemaVersion: 1,
    defaultDecision: item.defaultDecision as EnvironmentAdmissionPolicy["defaultDecision"],
    rules,
  };
}

export function validateEnvironmentObservation(
  value: EnvironmentObservation,
): EnvironmentObservation {
  const code = "invalid_environment_observation";
  const item = record(value, code, "environment observation");
  exactKeys(
    item,
    [
      "schemaVersion",
      "sourceId",
      "adapterId",
      "scope",
      "status",
      "observedAt",
      "validUntil",
      "subjects",
      "verification",
    ],
    code,
    "environment observation",
  );
  if (item.schemaVersion !== 1) fail(code, "Environment observation schemaVersion must be 1.");
  stringValue(item.sourceId, code, "sourceId", SOURCE_ID);
  stringValue(item.adapterId, code, "adapterId");
  if (item.scope !== "project" && item.scope !== "user" && item.scope !== "organization")
    fail(code, "Environment observation scope is invalid.");
  if (item.status !== "available" && item.status !== "unavailable")
    fail(code, "Environment observation status is invalid.");
  if (
    typeof item.observedAt !== "string" ||
    typeof item.validUntil !== "string" ||
    !RFC3339.test(item.observedAt) ||
    !RFC3339.test(item.validUntil) ||
    Date.parse(item.validUntil) < Date.parse(item.observedAt)
  )
    fail(code, "The observation time range is invalid.");
  if (
    !Array.isArray(item.subjects) ||
    !Array.isArray(item.verification) ||
    item.subjects.length > 256 ||
    item.verification.length < 1 ||
    item.verification.length > 16
  )
    fail(code, "The observation item-count limit was exceeded.");
  if (item.status === "unavailable" && item.subjects.length > 0)
    fail(code, "An unavailable observation cannot contain subjects.");
  const seenSubjects = new Set<string>();
  for (const subject of value.subjects) {
    const parsed = record(subject, code, "subject");
    exactKeys(
      parsed,
      ["subjectId", "kind", "labels", "capabilities", "endpoints"],
      code,
      "subject",
    );
    stringValue(subject.subjectId, code, "subjectId", SUBJECT_ID);
    if (seenSubjects.has(subject.subjectId)) fail(code, "subjectId is duplicated.");
    seenSubjects.add(subject.subjectId);
    if (subject.kind !== "device" && subject.kind !== "service" && subject.kind !== "runtime")
      fail(code, "subject.kind is invalid.");
    stringArray(subject.capabilities, code, "subject.capabilities");
    if (
      typeof subject.labels !== "object" ||
      subject.labels === null ||
      Array.isArray(subject.labels) ||
      !Array.isArray(subject.endpoints) ||
      Object.keys(subject.labels).length > 32 ||
      subject.endpoints.length > 16
    )
      fail(code, "The subject item-count limit was exceeded.");
    for (const [key, label] of Object.entries(subject.labels)) {
      stringValue(key, code, "subject label key");
      if (label.length === 0 || label.length > 512) fail(code, "A subject label value is invalid.");
    }
    for (const endpoint of subject.endpoints) {
      const parsedEndpoint = record(endpoint, code, "endpoint");
      exactKeys(parsedEndpoint, ["transport", "addressKind", "host", "port"], code, "endpoint");
      stringValue(endpoint.transport, code, "endpoint.transport");
      if (
        endpoint.addressKind !== "dns" &&
        endpoint.addressKind !== "ip" &&
        endpoint.addressKind !== "local"
      )
        fail(code, "endpoint.addressKind is invalid.");
      if (
        endpoint.host.length === 0 ||
        endpoint.host.length > 512 ||
        /[\r\n\0]/.test(endpoint.host)
      )
        fail(code, "endpoint.host is invalid.");
      if (
        endpoint.port !== undefined &&
        (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535)
      )
        fail(code, "endpoint.port is invalid.");
    }
  }
  for (const verification of value.verification) {
    const parsed = record(verification, code, "verification");
    exactKeys(parsed, ["kind", "status", "checkedAt", "failureCode"], code, "verification");
    stringValue(verification.kind, code, "verification.kind");
    if (verification.status !== "verified" && verification.status !== "unavailable")
      fail(code, "verification.status is invalid.");
    if (!RFC3339.test(verification.checkedAt)) fail(code, "verification.checkedAt is invalid.");
    if (verification.checkedAt !== value.observedAt)
      fail(code, "The verification time must equal the observation time.");
    if (verification.failureCode !== undefined)
      stringValue(verification.failureCode, code, "verification.failureCode");
    if (verification.status === "verified" && verification.failureCode !== undefined)
      fail(code, "A verified item cannot have a failureCode.");
  }
  if (
    value.status === "available" &&
    value.verification.some((verification) => verification.status !== "verified")
  )
    fail(code, "Every verification in an available observation must be verified.");
  if (
    value.status === "unavailable" &&
    value.verification.some((verification) => verification.status !== "unavailable")
  )
    fail(code, "Every verification in an unavailable observation must be unavailable.");
  return value;
}
