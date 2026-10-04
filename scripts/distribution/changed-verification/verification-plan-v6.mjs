import { createChangedRuntimeVerificationPlanV5 } from "./verification-plan-v5.mjs";

const SHARD_COUNT = 4;

export function createChangedRuntimeVerificationPlanV6(changedPaths, shardIndex) {
  if (!Number.isInteger(shardIndex) || shardIndex < 1 || shardIndex > SHARD_COUNT) {
    throw new Error(`The runtime verification shard must be an integer from 1 to ${SHARD_COUNT}.`);
  }
  const plan = createChangedRuntimeVerificationPlanV5(changedPaths);
  return {
    ...plan,
    shardIndex,
    shardCount: SHARD_COUNT,
    arguments: [...plan.arguments, `--shard=${shardIndex}/${SHARD_COUNT}`],
  };
}
