import { canonicalJson } from "@lervo/event-contract";
import type { CapabilityDecision, RoleEvaluationCheck, RoleProfile } from "@lervo/schemas";

import type { ResolvedRoleContract } from "./types.js";
import { RoleContractError } from "./types.js";

type RoleProfilePatch = Partial<Omit<RoleProfile, "schemaVersion" | "roleId">>;

function fail(message: string): never {
  throw new RoleContractError("role_profile_invalid", message);
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function same(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function capabilityRank(value: CapabilityDecision): number {
  return value === "deny" ? 2 : value === "require_approval" ? 1 : 0;
}

function restrictive(left: CapabilityDecision, right: CapabilityDecision): CapabilityDecision {
  return capabilityRank(left) >= capabilityRank(right) ? left : right;
}

function mergeInputs(
  groups: ReadonlyArray<ReadonlyArray<RoleProfile["requiredInputs"][number]>>,
): RoleProfile["requiredInputs"] {
  const inputs = new Map<string, RoleProfile["requiredInputs"][number]>();
  for (const group of groups) {
    for (const input of group) {
      const previous = inputs.get(input.name);
      if (previous !== undefined && !same(previous, input)) {
        fail(`Role input ${input.name} has incompatible inherited contracts.`);
      }
      inputs.set(input.name, structuredClone(input));
    }
  }
  return [...inputs.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function mergeChecks(groups: ReadonlyArray<ReadonlyArray<RoleEvaluationCheck>>) {
  const checks = new Map<string, RoleEvaluationCheck>();
  for (const group of groups) {
    for (const check of group) {
      const previous = checks.get(check.checkId);
      if (previous !== undefined && !same(previous, check)) {
        fail(`Role evaluation check ${check.checkId} has incompatible inherited contracts.`);
      }
      checks.set(check.checkId, structuredClone(check));
    }
  }
  return [...checks.values()].sort((left, right) => left.checkId.localeCompare(right.checkId));
}

function mergedBaseProfile(roleId: string, bases: ResolvedRoleContract[]): Partial<RoleProfile> {
  if (bases.length === 0) return { schemaVersion: 1, roleId };
  const profiles = bases.map((base) => base.definition.profile);
  const first = profiles[0]!;
  const outputContracts = profiles.map((profile) => profile.outputContract);
  const shared = {
    schemaVersion: 1 as const,
    roleId,
    requestTypes: sortedUnique(profiles.flatMap((profile) => profile.requestTypes)),
    requiredInputs: mergeInputs(profiles.map((profile) => profile.requiredInputs)),
    contextPolicy: {
      requiredDocumentRuleIds: sortedUnique(
        profiles.flatMap((profile) => profile.contextPolicy.requiredDocumentRuleIds),
      ),
      minimumAssurance: "E3" as const,
      referencesRequired: profiles.some((profile) => profile.contextPolicy.referencesRequired),
    },
    capabilities: Object.fromEntries(
      Object.keys(first.capabilities).map((key) => [
        key,
        profiles
          .slice(1)
          .reduce(
            (decision, profile) =>
              restrictive(decision, profile.capabilities[key as keyof typeof profile.capabilities]),
            first.capabilities[key as keyof typeof first.capabilities],
          ),
      ]),
    ) as RoleProfile["capabilities"],
    defaultSkills: sortedUnique(profiles.flatMap((profile) => profile.defaultSkills)),
    defaultCapabilityPackages: sortedUnique(
      profiles.flatMap((profile) => profile.defaultCapabilityPackages ?? []),
    ),
    verification: {
      suiteIds: sortedUnique(profiles.flatMap((profile) => profile.verification.suiteIds)),
      failureDisposition: profiles.some(
        (profile) => profile.verification.failureDisposition === "fail_run",
      )
        ? ("fail_run" as const)
        : ("require_review" as const),
    },
    handoff: {
      allowedRoleIds: sortedUnique(profiles.flatMap((profile) => profile.handoff.allowedRoleIds)),
      evidenceLinksRequired: true as const,
      sharedContextRequired: true as const,
    },
  };
  if (
    profiles.length > 1 &&
    outputContracts.some((contract) => !same(contract, outputContracts[0]))
  ) {
    return shared;
  }
  return {
    ...shared,
    name: first.name,
    description: first.description,
    outputContract: structuredClone(first.outputContract),
  };
}

function applyPatch(
  roleId: string,
  base: Partial<RoleProfile>,
  patch: RoleProfilePatch,
): RoleProfile {
  const result: Partial<RoleProfile> = { ...structuredClone(base), schemaVersion: 1, roleId };
  if (patch.name !== undefined) result.name = patch.name;
  if (patch.description !== undefined) result.description = patch.description;
  if (patch.requestTypes !== undefined)
    result.requestTypes = sortedUnique([...(result.requestTypes ?? []), ...patch.requestTypes]);
  if (patch.requiredInputs !== undefined)
    result.requiredInputs = mergeInputs([result.requiredInputs ?? [], patch.requiredInputs]);
  if (patch.contextPolicy !== undefined)
    result.contextPolicy = {
      requiredDocumentRuleIds: sortedUnique([
        ...(result.contextPolicy?.requiredDocumentRuleIds ?? []),
        ...patch.contextPolicy.requiredDocumentRuleIds,
      ]),
      minimumAssurance: "E3",
      referencesRequired:
        (result.contextPolicy?.referencesRequired ?? false) ||
        patch.contextPolicy.referencesRequired,
    };
  if (patch.capabilities !== undefined) {
    const inherited = result.capabilities;
    result.capabilities = Object.fromEntries(
      Object.entries(patch.capabilities).map(([key, decision]) => [
        key,
        inherited === undefined
          ? decision
          : restrictive(inherited[key as keyof typeof inherited], decision),
      ]),
    ) as RoleProfile["capabilities"];
    if (inherited !== undefined) result.capabilities = { ...inherited, ...result.capabilities };
  }
  if (patch.defaultSkills !== undefined)
    result.defaultSkills = sortedUnique([...(result.defaultSkills ?? []), ...patch.defaultSkills]);
  if (patch.defaultCapabilityPackages !== undefined)
    result.defaultCapabilityPackages = sortedUnique([
      ...(result.defaultCapabilityPackages ?? []),
      ...patch.defaultCapabilityPackages,
    ]);
  if (patch.outputContract !== undefined)
    result.outputContract = structuredClone(patch.outputContract);
  if (patch.verification !== undefined)
    result.verification = {
      suiteIds: sortedUnique([
        ...(result.verification?.suiteIds ?? []),
        ...patch.verification.suiteIds,
      ]),
      failureDisposition:
        result.verification?.failureDisposition === "fail_run" ||
        patch.verification.failureDisposition === "fail_run"
          ? "fail_run"
          : "require_review",
    };
  if (patch.handoff !== undefined)
    result.handoff = {
      allowedRoleIds: sortedUnique([
        ...(result.handoff?.allowedRoleIds ?? []),
        ...patch.handoff.allowedRoleIds,
      ]),
      evidenceLinksRequired: true,
      sharedContextRequired: true,
    };
  return result as RoleProfile;
}

export function composeRepositoryRoleProfile(
  roleId: string,
  bases: ResolvedRoleContract[],
  patch: RoleProfilePatch,
): RoleProfile {
  return applyPatch(roleId, mergedBaseProfile(roleId, bases), patch);
}

export function mergeRepositoryRoleChecks(
  bases: ResolvedRoleContract[],
  checks: RoleEvaluationCheck[],
): RoleEvaluationCheck[] {
  return mergeChecks([...bases.map((base) => base.definition.evaluation.checks), checks]);
}
