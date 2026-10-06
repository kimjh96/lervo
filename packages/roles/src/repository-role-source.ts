import type { RoleEvaluationCheck, RoleProfile } from "@lervo/schemas";

import { RoleContractError } from "./types.js";

/** The bounded v1 source contract of a `.lervo/roles/<role-id>.json` repository role. */
export const ROLE_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
export const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const PROFILE_KEYS = new Set([
  "name",
  "description",
  "requestTypes",
  "requiredInputs",
  "contextPolicy",
  "capabilities",
  "defaultSkills",
  "outputContract",
  "verification",
  "handoff",
  "defaultCapabilityPackages",
]);
const SOURCE_KEYS = new Set([
  "schemaVersion",
  "kind",
  "roleId",
  "version",
  "extends",
  "profile",
  "checks",
]);
const REFERENCE_KEYS = new Set(["roleId", "version"]);
const CAPABILITY_KEYS = new Set([
  "filesystem.read",
  "filesystem.write",
  "shell.execute",
  "network.access",
  "external.message",
  "computer.use",
  "deploy",
  "data.mutate",
]);
const CONTEXT_KEYS = new Set(["requiredDocumentRuleIds", "minimumAssurance", "referencesRequired"]);
const VERIFICATION_KEYS = new Set(["suiteIds", "failureDisposition"]);
const HANDOFF_KEYS = new Set(["allowedRoleIds", "evidenceLinksRequired", "sharedContextRequired"]);

type RoleProfilePatch = Partial<Omit<RoleProfile, "schemaVersion" | "roleId">>;

export interface RepositoryRoleSource {
  schemaVersion: 1;
  kind: "lervo_repository_role";
  roleId: string;
  version: string;
  extends: Array<{ roleId: string; version: string }>;
  profile: RoleProfilePatch;
  checks: RoleEvaluationCheck[];
}

export function fail(
  code: "role_profile_invalid" | "role_not_found" | "role_contract_stale",
  message: string,
  cause?: unknown,
): never {
  throw new RoleContractError(code, message, cause === undefined ? undefined : { cause });
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key));
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function validProfilePatch(value: Record<string, unknown>): boolean {
  if (value.name !== undefined && typeof value.name !== "string") return false;
  if (value.description !== undefined && typeof value.description !== "string") return false;
  if (value.requestTypes !== undefined && !strings(value.requestTypes)) return false;
  if (value.requiredInputs !== undefined && !Array.isArray(value.requiredInputs)) return false;
  if (value.defaultSkills !== undefined && !strings(value.defaultSkills)) return false;
  if (value.defaultCapabilityPackages !== undefined && !strings(value.defaultCapabilityPackages))
    return false;
  if (value.outputContract !== undefined && !record(value.outputContract)) return false;
  if (
    value.contextPolicy !== undefined &&
    (!record(value.contextPolicy) ||
      !exactKeys(value.contextPolicy, CONTEXT_KEYS) ||
      !strings(value.contextPolicy.requiredDocumentRuleIds) ||
      value.contextPolicy.minimumAssurance !== "E3" ||
      typeof value.contextPolicy.referencesRequired !== "boolean")
  )
    return false;
  if (
    value.capabilities !== undefined &&
    (!record(value.capabilities) ||
      !exactKeys(value.capabilities, CAPABILITY_KEYS) ||
      !Object.values(value.capabilities).every((decision) =>
        ["allow", "deny", "require_approval"].includes(String(decision)),
      ))
  )
    return false;
  if (
    value.verification !== undefined &&
    (!record(value.verification) ||
      !exactKeys(value.verification, VERIFICATION_KEYS) ||
      !strings(value.verification.suiteIds) ||
      !["fail_run", "require_review"].includes(String(value.verification.failureDisposition)))
  )
    return false;
  if (
    value.handoff !== undefined &&
    (!record(value.handoff) ||
      !exactKeys(value.handoff, HANDOFF_KEYS) ||
      !strings(value.handoff.allowedRoleIds) ||
      value.handoff.evidenceLinksRequired !== true ||
      value.handoff.sharedContextRequired !== true)
  )
    return false;
  return true;
}

export function parseRepositoryRoleSource(
  value: unknown,
  expectedRoleId?: string,
): RepositoryRoleSource {
  if (
    !record(value) ||
    !exactKeys(value, SOURCE_KEYS) ||
    value.schemaVersion !== 1 ||
    value.kind !== "lervo_repository_role" ||
    typeof value.roleId !== "string" ||
    !ROLE_ID.test(value.roleId) ||
    value.roleId.length > 100 ||
    typeof value.version !== "string" ||
    !VERSION.test(value.version) ||
    value.version.length > 100 ||
    !Array.isArray(value.extends) ||
    value.extends.length > 8 ||
    !record(value.profile) ||
    !exactKeys(value.profile, PROFILE_KEYS) ||
    !validProfilePatch(value.profile) ||
    !Array.isArray(value.checks) ||
    value.checks.length > 32 ||
    (expectedRoleId !== undefined && value.roleId !== expectedRoleId)
  ) {
    fail(
      "role_profile_invalid",
      "The repository role source does not satisfy the bounded v1 contract.",
    );
  }
  const references = value.extends as unknown[];
  if (
    !references.every(
      (item) =>
        record(item) &&
        exactKeys(item, REFERENCE_KEYS) &&
        typeof item.roleId === "string" &&
        ROLE_ID.test(item.roleId) &&
        typeof item.version === "string" &&
        VERSION.test(item.version),
    ) ||
    new Set(
      references.map(
        (item) => `${(item as { roleId: string }).roleId}@${(item as { version: string }).version}`,
      ),
    ).size !== references.length ||
    references.some((item) => (item as { roleId: string }).roleId === value.roleId)
  ) {
    fail(
      "role_profile_invalid",
      "The repository role ancestry is invalid, duplicated, or self-referential.",
    );
  }
  return structuredClone(value) as unknown as RepositoryRoleSource;
}
