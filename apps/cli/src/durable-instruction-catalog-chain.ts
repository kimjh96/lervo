import type { EventEnvelope } from "@lervo/schemas";

const MAXIMUM_CHAIN_STEPS = 64;

/**
 * ADR-0545: whether the instruction catalog moved from `from` to `to` only through recorded
 * durable-instruction applies. Each apply event binds the catalog digest before and after it, so a
 * candidate judged against `from` stays valid while every intervening change was an owner rule.
 */
export function catalogReachedThroughOwnerRuleApplies(input: {
  events: readonly EventEnvelope[];
  from: string;
  to: string;
}): boolean {
  const next = new Map<string, string>();
  for (const event of input.events) {
    if (event.type !== "knowledge.materialization.applied") continue;
    const payload = event.payload as Record<string, unknown>;
    if (
      payload.operation !== "durable_instruction_intake" ||
      typeof payload.beforeRegistryDigest !== "string" ||
      typeof payload.afterRegistryDigest !== "string"
    )
      continue;
    next.set(payload.beforeRegistryDigest, payload.afterRegistryDigest);
  }
  let digest = input.from;
  for (let step = 0; step < MAXIMUM_CHAIN_STEPS; step += 1) {
    const after = next.get(digest);
    if (after === undefined) return false;
    if (after === input.to) return true;
    digest = after;
  }
  return false;
}
