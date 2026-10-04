import { createChangedRuntimeVerificationPlanV7 } from "./verification-plan-v7.mjs";

const TEST_TIMEOUT_MS = 15_000;

export function createChangedRuntimeVerificationPlanV8(changedPaths, shardIndex) {
  const plan = createChangedRuntimeVerificationPlanV7(changedPaths, shardIndex);
  if (plan.arguments.some((argument) => argument.startsWith("--testTimeout="))) {
    throw new Error("The version-seven verification plan already sets a test timeout.");
  }
  return {
    ...plan,
    testTimeoutMs: TEST_TIMEOUT_MS,
    arguments: [...plan.arguments, `--testTimeout=${TEST_TIMEOUT_MS}`],
  };
}
