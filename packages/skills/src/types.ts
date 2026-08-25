import type { SkillLock, SkillLockRejection, SkillManifest } from "@lervo/schemas";

export type LocalSkillSourceKind = "project" | "user";
export type RuntimePlatform = "darwin" | "linux" | "win32";

export interface DiscoveredSkill {
  manifest: SkillManifest;
  directoryPath: string;
  source: {
    kind: LocalSkillSourceKind;
    uri: string;
  };
}

export interface SkillRuntimeContext {
  projectId: string;
  provider: string;
  roleId: string;
  runtimeVersion: string;
  platform: RuntimePlatform;
  availableTools: readonly string[];
  allowedCapabilities: readonly string[];
}

export interface SkillResolution {
  lock: SkillLock;
  selected: readonly DiscoveredSkill[];
  rejected: readonly SkillLockRejection[];
}

export type SkillResolutionErrorCode =
  | "ambiguous_skill_selection"
  | "content_hash_mismatch"
  | "invalid_skill_lock"
  | "invalid_skill_manifest"
  | "invalid_skill_request"
  | "no_compatible_skill"
  | "skill_lock_write_failed"
  | "skill_not_found"
  | "unsupported_runtime_platform"
  | "unsafe_skill_package";

export class SkillResolutionError extends Error {
  readonly reasons: readonly SkillLockRejection["reasonCode"][];

  constructor(
    readonly code: SkillResolutionErrorCode,
    message: string,
    options?: ErrorOptions & { reasons?: readonly SkillLockRejection["reasonCode"][] },
  ) {
    super(message, options);
    this.name = "SkillResolutionError";
    this.reasons = options?.reasons === undefined ? [] : [...new Set(options.reasons)].sort();
  }
}
