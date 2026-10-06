import { lstat, readFile, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";

import { canonicalJson } from "@lervo/event-contract";

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
import {
  fail,
  parseRepositoryRoleSource,
  ROLE_ID,
  type RepositoryRoleSource,
} from "./repository-role-source.js";
import type { ResolvedRoleContract, RoleContractCoordinate } from "./types.js";
import { RoleContractError } from "./types.js";

export { parseRepositoryRoleSource, type RepositoryRoleSource } from "./repository-role-source.js";

const BUILT_IN_VERSION = "1.0.0";
const MAXIMUM_ROLE_FILES = 256;
const MAXIMUM_ROLE_BYTES = 128 * 1024;
const MAXIMUM_COMPOSITION_DEPTH = 8;

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
  return resolveRoleContracts(await repositorySources(repositoryRoot));
}

/**
 * Resolves the registry as it would be if `overlay` sources were written to `.lervo/roles/`,
 * without writing anything. Callers prove a source reproduces a reviewed contract hash before
 * installing it (ADR-0477).
 */
export async function previewRoleContracts(
  repositoryRoot: string,
  overlay: readonly unknown[],
): Promise<ResolvedRoleContract[]> {
  const sources = await repositorySources(repositoryRoot);
  for (const value of overlay) {
    const source = parseRepositoryRoleSource(value);
    if (listBuiltInRoleDefinitions().some((item) => item.profile.roleId === source.roleId))
      fail("role_profile_invalid", `Repository role ${source.roleId} duplicates a built-in role.`);
    sources.set(source.roleId, { source, path: `.lervo/roles/${source.roleId}.json` });
  }
  if (sources.size > MAXIMUM_ROLE_FILES)
    fail("role_profile_invalid", "The repository role file limit was exceeded.");
  return resolveRoleContracts(sources);
}

function resolveRoleContracts(
  sources: Map<string, { source: RepositoryRoleSource; path: string }>,
): ResolvedRoleContract[] {
  const resolved = new Map<string, ResolvedRoleContract>();
  for (const definition of listBuiltInRoleDefinitions())
    resolved.set(
      definition.profile.roleId,
      builtInContract(definition.profile.roleId as BuiltInRoleId),
    );
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
