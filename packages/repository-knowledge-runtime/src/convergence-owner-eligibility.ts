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
 * Whether this checkout may contend for the Hub owner lease, and if not, why and until when.
 * `knowledge_authority_unavailable` means no usable delegation, which only a delegation change
 * restores. `provider_not_admitted` means the delegation is usable but no provider it allows was
 * admitted here; `wakeAt` is when that observation lapses, so the resident looks again then.
 */
export type ConvergenceOwnerEligibility =
  | { eligible: true }
  | { eligible: false; reason: "knowledge_authority_unavailable"; wakeAt: null }
  | { eligible: false; reason: "provider_not_admitted"; wakeAt: number };

const NO_AUTHORITY: ConvergenceOwnerEligibility = {
  eligible: false,
  reason: "knowledge_authority_unavailable",
  wakeAt: null,
};

/**
 * A host needs an active delegation for its provider. Under ADR-0478 only the owner renews, so a
 * lapsed delegation that the host policy would renew still qualifies: otherwise, once every
 * host's grant lapsed, no host could claim ownership and none could renew.
 *
 * A host whose latest provider admission, within the last hour, admitted none of the providers the
 * delegation allows cannot do the work either, as when its provider CLI is logged out. Holding the
 * lease there stalls every cycle, so it yields to a host that can.
 */
export async function convergenceOwnerEligibility(input: {
  root: string;
  provider: "codex" | "claude" | undefined;
  policyPath: string | null;
  now: number;
}): Promise<ConvergenceOwnerEligibility> {
  try {
    const loaded = await loadConvergenceDelegation(input.root);
    if (
      loaded === null ||
      loaded.delegation.state !== "active" ||
      (input.provider !== undefined && !loaded.delegation.providers.includes(input.provider))
    )
      return NO_AUTHORITY;
    const lapses = await delegatedProvidersUnadmittedUntil(
      input.root,
      loaded.delegation.providers,
      input.now,
    );
    if (lapses !== null)
      return { eligible: false, reason: "provider_not_admitted", wakeAt: lapses };
    if (Date.parse(loaded.delegation.expiresAt) > input.now) return { eligible: true };
    if (input.policyPath === null) return NO_AUTHORITY;
    const policy = await readConvergenceContinuityPolicy(input.policyPath);
    const renewal = decideDelegationRenewal({
      delegation: loaded.delegation,
      policy,
      now: input.now,
    });
    return renewal.kind === "renew" ? { eligible: true } : NO_AUTHORITY;
  } catch {
    return NO_AUTHORITY;
  }
}

/** When the observation that no delegated provider is admitted lapses, or null if none stands. */
async function delegatedProvidersUnadmittedUntil(
  root: string,
  delegated: readonly string[],
  now: number,
): Promise<number | null> {
  const projection = await readProviderCliProjection(root).catch(() => null);
  if (projection === null || !projection.waiting) return null;
  const lapses = Date.parse(projection.observedAt) + PROVIDER_UNADMITTED_INELIGIBILITY_MS;
  if (!(now < lapses)) return null;
  return projection.providers.some((cli) => cli.admitted && delegated.includes(cli.provider))
    ? null
    : lapses;
}
