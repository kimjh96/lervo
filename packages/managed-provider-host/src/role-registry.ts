import type { RoleProfile } from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";

import { createRemoteDeveloperRole } from "./role.js";

const ROLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const SKILL_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$/u;

function sameValues(left: readonly string[], right: readonly string[]): boolean {
  const first = [...left].sort();
  const second = [...right].sort();
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function isRemoteManagedRole(profile: RoleProfile): boolean {
  return (
    validateSchema("role", profile).valid &&
    profile.requiredInputs.length === 0 &&
    profile.contextPolicy.minimumAssurance === "E3" &&
    profile.contextPolicy.referencesRequired === true &&
    profile.roleId.length <= 100 &&
    profile.defaultSkills.length <= 16 &&
    new Set(profile.defaultSkills).size === profile.defaultSkills.length &&
    profile.defaultSkills.every(
      (skillId) => skillId.length <= 150 && SKILL_ID_PATTERN.test(skillId),
    ) &&
    profile.outputContract.presentation.audience === "machine" &&
    profile.outputContract.presentation.writingPolicyId === null &&
    profile.capabilities["filesystem.read"] === "allow" &&
    profile.capabilities["filesystem.write"] === "require_approval" &&
    profile.capabilities["shell.execute"] === "allow" &&
    profile.capabilities["network.access"] === "deny" &&
    profile.capabilities["external.message"] === "deny" &&
    profile.capabilities["computer.use"] === "deny" &&
    profile.capabilities.deploy === "deny" &&
    profile.capabilities["data.mutate"] === "deny"
  );
}

export class ManagedProviderHostRoleRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagedProviderHostRoleRegistryError";
  }
}

export class ManagedProviderHostRoleRegistry {
  private readonly profiles = new Map<string, RoleProfile>();
  private readonly developerSkillIds: readonly string[];

  constructor(
    customProfiles: readonly RoleProfile[] = [],
    developerSkillIds: readonly string[] = [],
  ) {
    if (
      developerSkillIds.length > 16 ||
      new Set(developerSkillIds).size !== developerSkillIds.length ||
      developerSkillIds.some((skillId) => skillId.length > 150 || !SKILL_ID_PATTERN.test(skillId))
    ) {
      throw new ManagedProviderHostRoleRegistryError(
        "The managed provider host developer skill ID is invalid.",
      );
    }
    this.developerSkillIds = Object.freeze([...developerSkillIds]);
    if (customProfiles.length > 15) {
      throw new ManagedProviderHostRoleRegistryError(
        "The managed provider host supports at most 15 custom roles.",
      );
    }
    for (const source of customProfiles) {
      const profile = clone(source);
      if (
        !ROLE_ID_PATTERN.test(profile.roleId) ||
        profile.roleId === "developer" ||
        this.profiles.has(profile.roleId) ||
        !isRemoteManagedRole(profile)
      ) {
        throw new ManagedProviderHostRoleRegistryError(
          "The managed provider host custom role profile does not satisfy the safe remote-execution contract.",
        );
      }
      this.profiles.set(profile.roleId, profile);
    }
  }

  roleIds(): string[] {
    return ["developer", ...this.profiles.keys()].sort();
  }

  resolve(roleId: string, verificationSuiteIds: readonly string[]): RoleProfile | null {
    if (roleId === "developer") {
      return createRemoteDeveloperRole(verificationSuiteIds, this.developerSkillIds);
    }
    const profile = this.profiles.get(roleId);
    if (profile === undefined || !sameValues(profile.verification.suiteIds, verificationSuiteIds))
      return null;
    return clone(profile);
  }
}
