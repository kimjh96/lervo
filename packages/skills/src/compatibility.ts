import type { SkillLockRejection } from "@roven/schemas";

import type { DiscoveredSkill, SkillRuntimeContext } from "./types.js";

function parseVersion(value: string): [number, number, number, string[]] {
  const buildIndex = value.indexOf("+");
  const version = buildIndex === -1 ? value : value.slice(0, buildIndex);
  const prereleaseIndex = version.indexOf("-");
  const core = prereleaseIndex === -1 ? version : version.slice(0, prereleaseIndex);
  const prerelease = prereleaseIndex === -1 ? "" : version.slice(prereleaseIndex + 1);
  const [major = "0", minor = "0", patch = "0"] = core.split(".");
  return [Number(major), Number(minor), Number(patch), prerelease === "" ? [] : prerelease.split(".")];
}

export function compareSemver(left: string, right: string): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (a[index] as number) - (b[index] as number);
    if (difference !== 0) return difference;
  }
  const leftPre = a[3];
  const rightPre = b[3];
  if (leftPre.length === 0 || rightPre.length === 0) {
    return leftPre.length === rightPre.length ? 0 : leftPre.length === 0 ? 1 : -1;
  }
  for (let index = 0; index < Math.max(leftPre.length, rightPre.length); index += 1) {
    const leftPart = leftPre[index];
    const rightPart = rightPre[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) continue;
    const leftNumber = /^[0-9]+$/.test(leftPart) ? Number(leftPart) : null;
    const rightNumber = /^[0-9]+$/.test(rightPart) ? Number(rightPart) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
    if (leftNumber !== null || rightNumber !== null) return leftNumber !== null ? -1 : 1;
    return leftPart < rightPart ? -1 : 1;
  }
  return 0;
}

export function rejectionReason(
  candidate: DiscoveredSkill,
  runtime: SkillRuntimeContext,
): SkillLockRejection["reasonCode"] | null {
  const manifest = candidate.manifest;
  if (
    manifest.enabledScope.kind === "disabled" ||
    (manifest.enabledScope.kind === "projects" &&
      !manifest.enabledScope.projectIds.includes(runtime.projectId))
  ) return "scope_disabled";
  if (
    manifest.compatibility.providers.mode === "allowlist" &&
    !manifest.compatibility.providers.providers.includes(runtime.provider)
  ) return "provider_incompatible";
  if (!manifest.supportedRoles.includes(runtime.roleId)) return "role_incompatible";
  if (compareSemver(runtime.runtimeVersion, manifest.compatibility.minimumRuntimeVersion) < 0) {
    return "runtime_incompatible";
  }
  if (!manifest.compatibility.platforms.includes(runtime.platform)) {
    return "platform_incompatible";
  }
  if (manifest.compatibility.requiredTools.some((tool) => !runtime.availableTools.includes(tool))) {
    return "tool_unavailable";
  }
  if (manifest.requiredCapabilities.some((item) => !runtime.allowedCapabilities.includes(item))) {
    return "capability_denied";
  }
  return null;
}
