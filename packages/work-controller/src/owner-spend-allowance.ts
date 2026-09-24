import type { OperatingMandateV3 } from "@lervo/application-contract";

type Allowance = NonNullable<OperatingMandateV3["ownerSpendAllowance"]>;

/** Exact decision reservations in one owner's post-anchor epoch; no cross-model usage conversion. */
export function projectOwnerSpendAllowance(input: {
  allowance: Allowance;
  currentDecisionId: string;
  reservations: readonly {
    decisionId: string;
    reservedTokens: number;
    observedTokens: number | null;
    usageUnavailable: boolean;
  }[];
}): {
  disposition: "within" | "exceeded";
  reservedTokens: number;
  remainingTokens: number;
} {
  const { allowance, currentDecisionId, reservations } = input;
  const seen = new Set<string>();
  let reservedTokens = 0;
  let uncertainOrOverrun = false;
  for (const item of reservations) {
    if (
      !/^osd_[a-f0-9]{24}$/u.test(item.decisionId) ||
      seen.has(item.decisionId) ||
      !Number.isSafeInteger(item.reservedTokens) ||
      item.reservedTokens < 1 ||
      (item.observedTokens !== null &&
        (!Number.isSafeInteger(item.observedTokens) || item.observedTokens < 0)) ||
      (item.usageUnavailable && item.observedTokens !== null)
    )
      throw new Error("The owner spend epoch has an invalid or duplicate reservation.");
    seen.add(item.decisionId);
    if (item.usageUnavailable || (item.observedTokens ?? 0) > item.reservedTokens)
      uncertainOrOverrun = true;
    reservedTokens += item.reservedTokens;
    if (!Number.isSafeInteger(reservedTokens))
      throw new Error("The owner spend epoch exceeds safe integer accounting.");
  }
  if (!seen.has(currentDecisionId))
    throw new Error("The owner spend epoch omits its current decision.");
  const remainingTokens = Math.max(0, allowance.maximumReservedTokens - reservedTokens);
  return {
    disposition:
      !uncertainOrOverrun && reservedTokens <= allowance.maximumReservedTokens
        ? "within"
        : "exceeded",
    reservedTokens,
    remainingTokens,
  };
}
