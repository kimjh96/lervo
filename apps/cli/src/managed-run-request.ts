import { normalizeRepositoryPath } from "@lervo/context";

export function resolveManagedRunExpectedPaths(input: {
  expectedPath?: string;
  expectedPaths?: readonly string[];
}): string[] {
  if (input.expectedPath !== undefined && input.expectedPaths !== undefined) {
    throw new TypeError("A managed run accepts expectedPath or expectedPaths, not both.");
  }
  const requested =
    input.expectedPaths ?? (input.expectedPath === undefined ? [] : [input.expectedPath]);
  const normalized = requested.map(normalizeRepositoryPath);
  if (
    normalized.length === 0 ||
    normalized.length > 128 ||
    new Set(normalized).size !== normalized.length
  ) {
    throw new TypeError("A managed run requires 1 to 128 unique expected paths.");
  }
  return normalized;
}

/**
 * A supervised responsibility without filesystem.write grants no repository write: its run is
 * observation-only, and its expected paths scope what it reads rather than what it may change.
 */
export function supervisedRunIsReadOnly(input: {
  supervisedInvocation?: {
    effect: { responsibility: { requiredCapabilities: readonly string[] } };
  };
}): boolean {
  return (
    input.supervisedInvocation !== undefined &&
    !input.supervisedInvocation.effect.responsibility.requiredCapabilities.includes(
      "filesystem.write",
    )
  );
}
