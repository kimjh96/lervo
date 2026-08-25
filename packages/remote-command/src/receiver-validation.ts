import { type RemoteCommandTarget } from "@lervo/schemas";

import { RemoteCommandRuntimeError } from "./errors.js";
import { type RemoteCommandClock } from "./types.js";

const DEFAULT_MAX_LIFETIME_MS = 5 * 60_000;
const MAX_MAX_LIFETIME_MS = 15 * 60_000;
const DEFAULT_CLOCK_SKEW_MS = 30_000;
const MAX_CLOCK_SKEW_MS = 60_000;

export const systemRemoteCommandClock: RemoteCommandClock = {
  now: () => new Date().toISOString(),
};

export function parseRemoteCommandTimestamp(value: string, label: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new RemoteCommandRuntimeError(
      "invalid_command",
      `The remote command ${label} is invalid.`,
    );
  }
  return timestamp;
}

export function isRemoteCommandTarget(target: unknown): target is RemoteCommandTarget {
  if (
    typeof target !== "object" ||
    target === null ||
    !("projectId" in target) ||
    typeof target.projectId !== "string" ||
    !("projectIdentityHash" in target) ||
    typeof target.projectIdentityHash !== "string"
  ) {
    return false;
  }
  return (
    /^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(target.projectId) &&
    /^sha256:[a-f0-9]{64}$/.test(target.projectIdentityHash)
  );
}

export function assertRemoteCommandTarget(target: RemoteCommandTarget): void {
  if (!isRemoteCommandTarget(target)) {
    throw new RemoteCommandRuntimeError(
      "invalid_runtime_configuration",
      "The remote command receiver target is invalid.",
    );
  }
}

export function sameRemoteCommandTarget(
  left: RemoteCommandTarget,
  right: RemoteCommandTarget,
): boolean {
  return (
    left.projectId === right.projectId && left.projectIdentityHash === right.projectIdentityHash
  );
}

function resolveDuration(
  value: number | undefined,
  fallback: number,
  maximum: number,
  label: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 0 || resolved > maximum) {
    throw new RemoteCommandRuntimeError(
      "invalid_runtime_configuration",
      `The remote command ${label} configuration is invalid.`,
    );
  }
  return resolved;
}

export function resolveRemoteCommandTiming(input: {
  maxLifetimeMs?: number;
  clockSkewMs?: number;
}): { maxLifetimeMs: number; clockSkewMs: number } {
  return {
    maxLifetimeMs: resolveDuration(
      input.maxLifetimeMs,
      DEFAULT_MAX_LIFETIME_MS,
      MAX_MAX_LIFETIME_MS,
      "maxLifetimeMs",
    ),
    clockSkewMs: resolveDuration(
      input.clockSkewMs,
      DEFAULT_CLOCK_SKEW_MS,
      MAX_CLOCK_SKEW_MS,
      "clockSkewMs",
    ),
  };
}
