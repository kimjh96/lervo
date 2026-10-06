import { readConvergenceContinuityPolicy } from "./continuity-policy-store.js";
import { loadConvergenceDelegation } from "./delegation.js";
import { decideDelegationRenewal } from "./delegation-continuity-decision.js";

/**
 * Whether this checkout may contend for the Hub owner lease. A host needs an active delegation
 * for its provider. Under ADR-0478 only the owner renews, so a lapsed delegation that the host
 * policy would renew still qualifies: otherwise, once every host's grant lapsed, no host could
 * claim ownership and none could renew.
 */
export async function convergenceOwnerEligible(input: {
  root: string;
  provider: "codex" | "claude" | undefined;
  policyPath: string | null;
  now: number;
}): Promise<boolean> {
  try {
    const loaded = await loadConvergenceDelegation(input.root);
    if (
      loaded === null ||
      loaded.delegation.state !== "active" ||
      (input.provider !== undefined && !loaded.delegation.providers.includes(input.provider))
    )
      return false;
    if (Date.parse(loaded.delegation.expiresAt) > input.now) return true;
    if (input.policyPath === null) return false;
    const policy = await readConvergenceContinuityPolicy(input.policyPath);
    return (
      decideDelegationRenewal({ delegation: loaded.delegation, policy, now: input.now }).kind ===
      "renew"
    );
  } catch {
    return false;
  }
}
