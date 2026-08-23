import type { AdapterExecutionMode } from "@lervo/schemas";

import { normalizeExpectedWritePaths } from "./validation.js";

export interface ManagedWritePlan {
  executionMode: AdapterExecutionMode;
  allowedPaths: readonly string[];
  minimumVerifiedChanges: number;
  maximumVerifiedChanges: number;
  pathsPerTurn: 1;
}

export function createManagedWritePlan(input: {
  executionMode: AdapterExecutionMode;
  expectedPaths: readonly string[];
}): ManagedWritePlan {
  const allowedPaths = normalizeExpectedWritePaths(input.expectedPaths);
  const requiresWrite = input.executionMode === "managed_write";
  const requiredChanges = requiresWrite ? allowedPaths.length : 0;
  return Object.freeze({
    executionMode: input.executionMode,
    allowedPaths: Object.freeze([...allowedPaths]),
    minimumVerifiedChanges: requiredChanges,
    maximumVerifiedChanges: requiredChanges,
    pathsPerTurn: 1 as const,
  });
}
