import type { ContinuityOwnerHostObservation } from "./continuity-findings.js";
import type { ConvergenceOwnerHost } from "./convergence-owner-host.js";
import type { ConvergenceOwnerHostDerivationResult } from "./convergence-owner-host-derivation.js";

/** Pure: the owner-host outcome the state records and findings read. */
export function ownerHostObservation(
  derivation: ConvergenceOwnerHostDerivationResult | null,
  host: ConvergenceOwnerHost | null,
): ContinuityOwnerHostObservation {
  const state: ContinuityOwnerHostObservation["state"] =
    host === null || derivation === null || derivation.derivation.status === "invalid"
      ? "invalid"
      : derivation.derivation.status === "operator"
        ? "operator"
        : host.config.coordination.mode;
  return {
    state,
    // ADR-0656: a missing own credential is named as such, not as the probe's 403 or unreadable
    // token, so the remediation can say exactly which credential to create.
    hubFailureCode:
      state === "hub" && derivation?.credentialAbsent === true
        ? "hub_credential_absent"
        : state === "standalone" || state === "hub"
          ? (derivation?.hubFailure?.failureCode ?? null)
          : null,
    publication:
      host?.config.coordination.mode !== "hub"
        ? "not_applicable"
        : host.config.publication === undefined
          ? "unavailable"
          : "configured",
  };
}
