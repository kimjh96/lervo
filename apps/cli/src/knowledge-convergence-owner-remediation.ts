import type { ConvergenceOwnerVerdict } from "@lervo/repository-knowledge-runtime";

/** The non-secret Hub scope a remediation names; null when this host is not Hub-configured. */
export interface ConvergenceOwnerHubScope {
  projectId: string;
  destinationId: string;
}

const STATUS_COMMAND = "lervo knowledge convergence owner status";

function scopeText(scope: ConvergenceOwnerHubScope | null): string {
  return scope === null
    ? "this repository's project at the configured Hub destination"
    : `project ${scope.projectId} at Hub destination ${scope.destinationId}`;
}

/**
 * The exact next step for a non-owning verdict, keyed by its recorded Hub failure cause. The Hub
 * does not reveal the principal behind a token, so the instruction names the token instead.
 */
export function convergenceOwnerRemediation(
  verdict: ConvergenceOwnerVerdict,
  scope: ConvergenceOwnerHubScope | null,
): string | null {
  if (verdict.role === "contended")
    return "Two hosts commit background knowledge for this repository. Configure both in hub mode with one Hub; see the cross-host ownership specification.";
  if (verdict.role !== "unverifiable") return null;
  const status =
    verdict.httpStatus === null || verdict.httpStatus === undefined
      ? ""
      : ` (HTTP ${verdict.httpStatus})`;
  switch (verdict.failureCode) {
    case "hub_forbidden":
      return `The Hub refused this host's convergence owner token${status}. Grant workspace.read and workspace.coordinate for ${scopeText(scope)} to the Hub principal that owns the token in this host's bearerTokenFile, then run ${STATUS_COMMAND}.`;
    case "hub_unauthorized":
      return `The Hub did not accept this host's convergence owner token${status}. Replace the token in this host's bearerTokenFile with a current credential for ${scopeText(scope)}, then run ${STATUS_COMMAND}.`;
    case "hub_unreachable":
      return `The Hub did not answer the convergence owner request${status}. Check that the configured baseUrl is reachable from this host and the Hub is running, then run ${STATUS_COMMAND}.`;
    case "hub_identity_mismatch":
      return `The answering service is not the configured Hub. Compare hubIdentityHash in this host's convergence owner configuration with the Hub's identity, then run ${STATUS_COMMAND}.`;
    case "hub_response_invalid":
      return `The Hub answered the convergence owner request with an unexpected response${status}. Check that the Hub runs a version with the ADR-0466 owner lease, then run ${STATUS_COMMAND}.`;
    case "hub_configuration_invalid":
      return `This host's Hub coordinates or token cannot form a convergence owner request. Fix baseUrl, destinationId, hubIdentityHash, or the token in bearerTokenFile, then run ${STATUS_COMMAND}.`;
    case "token_file_unreadable":
      return `This host cannot read its convergence owner token safely. Make bearerTokenFile an owner-only (mode 0600) regular file that holds the token, then run ${STATUS_COMMAND}.`;
    default:
      return `This host cannot prove it owns background knowledge convergence. Check its Hub configuration and reachability with ${STATUS_COMMAND}.`;
  }
}
