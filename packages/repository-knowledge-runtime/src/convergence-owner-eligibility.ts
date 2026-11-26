import { readConvergenceContinuityPolicy } from "./continuity-policy-store.js";
import { loadConvergenceDelegation } from "./delegation.js";
import { decideDelegationRenewal } from "./delegation-continuity-decision.js";
import { readProviderCliProjection } from "./provider-cli-projection.js";

/**
 * How long a host that admitted none of its delegated providers stays out of the lease. Past this,
 * the observation may be stale, as after the owner logged the provider back in, so the host may
 * contend again; a failing claim then records a fresh observation and yields once more.
 */
export const PROVIDER_UNADMITTED_INELIGIBILITY_MS = 60 * 60_000;

/**
 * Whether this checkout may contend for the Hub owner lease. A host needs an active delegation
 * for its provider. Under ADR-0478 only the owner renews, so a lapsed delegation that the host
 * policy would renew still qualifies: otherwise, once every host's grant lapsed, no host could
 * claim ownership and none could renew.
 *
 * A host whose latest provider admission, within the last hour, admitted none of the providers the
 * delegation allows cannot do the work either, as when its provider CLI is logged out. Holding the
 * lease there stalls every cycle, so it yields to a host that can.
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
    if (await delegatedProvidersUnadmitted(input.root, loaded.delegation.providers, input.now))
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

async function delegatedProvidersUnadmitted(
  root: string,
  delegated: readonly string[],
  now: number,
): Promise<boolean> {
  const projection = await readProviderCliProjection(root).catch(() => null);
  if (projection === null || !projection.waiting) return false;
  const observedAt = Date.parse(projection.observedAt);
  if (!(now - observedAt < PROVIDER_UNADMITTED_INELIGIBILITY_MS)) return false;
  return !projection.providers.some((cli) => cli.admitted && delegated.includes(cli.provider));
}
