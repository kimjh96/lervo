import type { OperatingMandateV3 } from "@lervo/application-contract";

type Allowance = NonNullable<OperatingMandateV3["ownerSpendAllowance"]>;

type Reservation = {
  decisionId: string;
  reservedTokens: number;
  observedTokens: number | null;
  usageUnavailable: boolean;
};

/**
 * A completed turn is charged its provider-reported usage, which ADR-0432 enforces in the same
 * measure as its reservation; a turn without a usage receipt stays charged in full.
 */
function sumReservations(reservations: readonly Reservation[]) {
  const seen = new Set<string>();
  let chargedTokens = 0;
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
    chargedTokens += item.observedTokens ?? item.reservedTokens;
    if (!Number.isSafeInteger(chargedTokens))
      throw new Error("The owner spend epoch exceeds safe integer accounting.");
  }
  return { seen, chargedTokens, uncertainOrOverrun };
}

/** Charged decisions in one owner's post-anchor epoch; usage is never converted across models. */
export function projectOwnerSpendAllowance(input: {
  allowance: Allowance;
  currentDecisionId: string;
  reservations: readonly Reservation[];
}): {
  disposition: "within" | "exceeded";
  chargedTokens: number;
  remainingTokens: number;
} {
  const { allowance, currentDecisionId, reservations } = input;
  const { seen, chargedTokens, uncertainOrOverrun } = sumReservations(reservations);
  if (!seen.has(currentDecisionId))
    throw new Error("The owner spend epoch omits its current decision.");
  const remainingTokens = Math.max(0, allowance.maximumReservedTokens - chargedTokens);
  return {
    disposition:
      !uncertainOrOverrun && chargedTokens <= allowance.maximumReservedTokens
        ? "within"
        : "exceeded",
    chargedTokens,
    remainingTokens,
  };
}

/**
 * Whether one more full reservation could be admitted before any decision is recorded. A proposal
 * the epoch cannot admit would only record another unspendable reservation.
 */
export function ownerSpendAdmitsReservation(input: {
  allowance: Allowance;
  reservations: readonly Reservation[];
  nextReservedTokens: number;
}): boolean {
  if (!Number.isSafeInteger(input.nextReservedTokens) || input.nextReservedTokens < 1)
    throw new Error("The next owner reservation is invalid.");
  const { chargedTokens, uncertainOrOverrun } = sumReservations(input.reservations);
  return (
    !uncertainOrOverrun &&
    chargedTokens + input.nextReservedTokens <= input.allowance.maximumReservedTokens
  );
}
