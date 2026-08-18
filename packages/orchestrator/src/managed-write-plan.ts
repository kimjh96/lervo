import type { AdapterExecutionMode } from "@roven/schemas";

import { normalizeExpectedWritePaths } from "./validation.js";

export interface ManagedWritePlan {
  executionMode: AdapterExecutionMode;
  allowedPaths: readonly string[];
  minimumVerifiedChanges: number;
  maximumVerifiedChanges: number;
  contextAfterChange: "invalidate";
}

export function createManagedWritePlan(input: {
  executionMode: AdapterExecutionMode;
  expectedPaths: readonly string[];
}): ManagedWritePlan {
  const allowedPaths = normalizeExpectedWritePaths(input.expectedPaths);
  const requiresWrite = input.executionMode === "managed_write";
  return Object.freeze({
    executionMode: input.executionMode,
    allowedPaths: Object.freeze([...allowedPaths]),
    minimumVerifiedChanges: requiresWrite ? 1 : 0,
    maximumVerifiedChanges: requiresWrite ? 1 : 0,
    contextAfterChange: "invalidate" as const,
  });
}
