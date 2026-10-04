import { createChangedRuntimeVerificationPlan } from "./verification-plan.mjs";

export function createChangedRuntimeVerificationPlanV5(changedPaths) {
  const plan = createChangedRuntimeVerificationPlan(changedPaths);
  const workerFlags = plan.arguments.filter((argument) => argument === "--maxWorkers=1");
  if (workerFlags.length !== 1) {
    throw new Error("The version-four verification plan has an unexpected worker bound.");
  }
  return {
    ...plan,
    arguments: plan.arguments.map((argument) =>
      argument === "--maxWorkers=1" ? "--maxWorkers=4" : argument,
    ),
  };
}
