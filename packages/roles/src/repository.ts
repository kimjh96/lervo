import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { canonicalJson } from "@lervo/event-contract";
import type { RoleEvaluationCheck, RoleProfile } from "@lervo/schemas";

import { assertRoleDefinition } from "./definition.js";
import { roleProfileHash, roleSha256 } from "./integrity.js";
import { defineRole } from "./profile-builder.js";
import {
  composeRepositoryRoleProfile,
  mergeRepositoryRoleChecks,
} from "./repository-role-composition.js";
import {
  getBuiltInRoleDefinition,
  listBuiltInRoleDefinitions,
  type BuiltInRoleId,
} from "./profiles.js";
import type { ResolvedRoleContract, RoleContractCoordinate } from "./types.js";
import { RoleContractError } from "./types.js";

const ROLE_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const BUILT_IN_VERSION = "1.0.0";
const MAXIMUM_ROLE_FILES = 256;
const MAXIMUM_ROLE_BYTES = 128 * 1024;
const MAXIMUM_COMPOSITION_DEPTH = 8;
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

function fail(
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

function builtInContract(roleId: BuiltInRoleId): ResolvedRoleContract {
  const definition = getBuiltInRoleDefinition(roleId);
  assertRoleDefinition(definition);
  const material = {
    schemaVersion: 1 as const,
    sourceKind: "built_in" as const,
    roleId,
    version: BUILT_IN_VERSION,
    extends: [],
    definition,
  };
  return { ...material, sourcePath: null, contractHash: roleSha256(canonicalJson(material)) };
}

function customContract(
  source: RepositoryRoleSource,
  bases: ResolvedRoleContract[],
  sourcePath: string,
): ResolvedRoleContract {
  if (
    bases.length > 1 &&
    (source.profile.name === undefined ||
      source.profile.description === undefined ||
      source.profile.outputContract === undefined)
  ) {
    fail(
      "role_profile_invalid",
      "A composed role must explicitly define its name, description, and output contract.",
    );
  }
  const profile = composeRepositoryRoleProfile(source.roleId, bases, source.profile);
  const checks = mergeRepositoryRoleChecks(bases, source.checks);
  const definition = defineRole(profile, checks);
  assertRoleDefinition(definition);
  const ancestry = bases.map(({ roleId, version, contractHash }) => ({
    roleId,
    version,
    contractHash,
  }));
  const material = {
    schemaVersion: 1 as const,
    sourceKind: "repository" as const,
    roleId: source.roleId,
    version: source.version,
    extends: ancestry,
    definition,
  };
  return { ...material, sourcePath, contractHash: roleSha256(canonicalJson(material)) };
}

async function repositorySources(
  repositoryRoot: string,
): Promise<Map<string, { source: RepositoryRoleSource; path: string }>> {
  const directory = resolve(repositoryRoot, ".lervo/roles");
  let directoryInfo;
  try {
    directoryInfo = await lstat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    fail("role_profile_invalid", "The repository role directory could not be inspected.", error);
  }
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink())
    fail("role_profile_invalid", "The repository role path must be a physical directory.");
  const names = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
  if (names.length > MAXIMUM_ROLE_FILES)
    fail("role_profile_invalid", "The repository role file limit was exceeded.");
  const result = new Map<string, { source: RepositoryRoleSource; path: string }>();
  for (const name of names) {
    const expectedRoleId = basename(name, ".json");
    if (!ROLE_ID.test(expectedRoleId))
      fail("role_profile_invalid", `Repository role filename ${name} is invalid.`);
    const path = resolve(directory, name);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAXIMUM_ROLE_BYTES)
      fail("role_profile_invalid", `Repository role source ${name} is unsafe.`);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      fail("role_profile_invalid", `Repository role source ${name} is not valid JSON.`, error);
    }
    const source = parseRepositoryRoleSource(parsed, expectedRoleId);
    if (
      listBuiltInRoleDefinitions().some(
        (definition) => definition.profile.roleId === source.roleId,
      ) ||
      result.has(source.roleId)
    )
      fail(
        "role_profile_invalid",
        `Repository role ${source.roleId} duplicates an existing role ID.`,
      );
    result.set(source.roleId, { source, path: `.lervo/roles/${name}` });
  }
  return result;
}

export async function listRoleContracts(repositoryRoot: string): Promise<ResolvedRoleContract[]> {
  const resolved = new Map<string, ResolvedRoleContract>();
  for (const definition of listBuiltInRoleDefinitions())
    resolved.set(
      definition.profile.roleId,
      builtInContract(definition.profile.roleId as BuiltInRoleId),
    );
  const sources = await repositorySources(repositoryRoot);
  const resolving = new Set<string>();
  const resolveCustom = (roleId: string, depth: number): ResolvedRoleContract => {
    const present = resolved.get(roleId);
    if (present !== undefined) return present;
    const entry = sources.get(roleId);
    if (entry === undefined)
      fail(
        "role_not_found",
        `Role ${roleId} does not exist in the built-in or repository registry.`,
      );
    if (depth > MAXIMUM_COMPOSITION_DEPTH || resolving.has(roleId))
      fail("role_profile_invalid", `Role ${roleId} has cyclic or over-deep ancestry.`);
    resolving.add(roleId);
    try {
      const bases = entry.source.extends.map((reference) => {
        const base = resolveCustom(reference.roleId, depth + 1);
        if (base.version !== reference.version)
          fail(
            "role_contract_stale",
            `Role ${roleId} requires ${reference.roleId}@${reference.version}, but ${base.version} is current.`,
          );
        return base;
      });
      let contract: ResolvedRoleContract;
      try {
        contract = customContract(entry.source, bases, entry.path);
      } catch (error) {
        if (error instanceof RoleContractError) throw error;
        fail(
          "role_profile_invalid",
          `Role ${roleId} could not be resolved into a valid executable contract.`,
          error,
        );
      }
      resolved.set(roleId, contract);
      return contract;
    } finally {
      resolving.delete(roleId);
    }
  };
  for (const roleId of [...sources.keys()].sort()) resolveCustom(roleId, 1);
  return [...resolved.values()]
    .sort((left, right) => left.roleId.localeCompare(right.roleId))
    .map((contract) => structuredClone(contract));
}

export async function resolveRoleContract(
  repositoryRoot: string,
  roleId: string,
): Promise<ResolvedRoleContract> {
  if (!ROLE_ID.test(roleId) || roleId.length > 100)
    fail("role_not_found", "The requested role ID is invalid.");
  const contract = (await listRoleContracts(repositoryRoot)).find((item) => item.roleId === roleId);
  if (contract === undefined)
    fail("role_not_found", `Role ${roleId} does not exist in the built-in or repository registry.`);
  return contract;
}

export function roleContractCoordinate(contract: ResolvedRoleContract): RoleContractCoordinate {
  return {
    roleId: contract.roleId,
    version: contract.version,
    contractHash: contract.contractHash,
  };
}

export function assertRoleContractBinding(
  contract: ResolvedRoleContract,
  binding: {
    roleId: string;
    roleVersion: string;
    roleContractHash: string;
    roleProfileHash: string;
  },
): void {
  if (
    binding.roleId !== contract.roleId ||
    binding.roleVersion !== contract.version ||
    binding.roleContractHash !== contract.contractHash ||
    binding.roleProfileHash !== roleProfileHash(contract.definition.profile)
  ) {
    fail(
      "role_contract_stale",
      `Role ${binding.roleId} no longer matches its versioned repository contract.`,
    );
  }
}
