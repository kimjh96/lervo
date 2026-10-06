import type { ContinuityFinding } from "@lervo/repository-knowledge-runtime";

const INSTALL_POLICY =
  "lervo knowledge convergence delegation renewal-policy install, then rerun it with --apply <policy-id>";
const REVIEW_DELEGATION =
  "lervo knowledge convergence delegation --from <reviewed-delegation.json>, then --apply <plan-id>";
const DOCTOR = "lervo knowledge convergence doctor";

const SEED_FAILURES: Record<string, string> = {
  convergence_seed_parent_missing:
    "No local agent can answer for the peer's scope. Register the parent role with lervo agent hire, or review a delegation here",
  convergence_seed_role_mismatch:
    "This host resolves the peer's role pins to different hashes. Run the same Lervo version on both hosts (lervo upgrade), or review a delegation here",
  convergence_seed_roots_missing:
    "None of the template's canonical or normalization roots exist in this checkout. Review a delegation with this repository's roots",
  convergence_seed_verification_missing:
    "The repository has no repository.default.vN or repository.default verification suite. Add .lervo/verifications/repository.default.v1.yaml, then the resident seeds on its next cycle",
  convergence_seed_identity_mismatch:
    "The peer's delegation names another repository identity. Check that both checkouts share one .lervo/project.json",
  knowledge_authority_unavailable:
    "The continued delegation no longer passes its role, suite, or ancestry checks, so the scope changed. Review a new delegation",
  knowledge_reader_transition_required:
    "This checkout's event store still writes a schema older than 4. Run lervo upgrade on this host",
  knowledge_plan_stale:
    "The delegation changed while it was continued. The resident retries on its next cycle; nothing else is needed",
  convergence_continuity_horizon_exhausted:
    "The continuity policy horizon has ended. Reinstall the policy",
};

const HUB_FAILURES: Record<string, string> = {
  hub_forbidden:
    "The Hub refused this host's credential for this project. Upgrade the Hub to an ADR-0469 version, which lets a credential with sync.write coordinate knowledge for its projects, or add this project to the credential's projects",
  hub_unauthorized:
    "The Hub did not accept the token in this host's Node configuration. Replace it with a current credential",
  hub_unreachable: "The Hub did not answer. Check that it runs and is reachable from this host",
  hub_identity_mismatch:
    "The answering service is not the configured Hub. Compare hubIdentityHash with the Hub's identity",
  hub_response_invalid:
    "The Hub answered unexpectedly. Upgrade it to a version with ADR-0469 host records",
  hub_configuration_invalid: "The Hub coordinates or token cannot form a request. Fix them",
  token_file_unreadable: "Make the Hub bearer token file an owner-only (0600) regular file",
};

function hubFailure(detail: string | null): string {
  return (detail === null ? undefined : HUB_FAILURES[detail]) ?? "Check the Hub configuration";
}

/** The exact next step for one continuity finding; the system retries everything else itself. */
export function continuityRemediation(finding: ContinuityFinding): string {
  switch (finding.code) {
    case "delegation_missing":
      return finding.severity === "owner_decision"
        ? `Another host converges this repository, but this host has no delegation and no continuity policy to seed one. Install the host policy once from a repository with a reviewed delegation (${INSTALL_POLICY}); every resident on this host then seeds itself.`
        : finding.severity === "info"
          ? "No host has delegated background knowledge for this repository, so it is not enrolled."
          : `${SEED_FAILURES[finding.detail ?? ""] ?? "The resident seeds a delegation on its next cycle"}. Run lervo knowledge convergence delegation seed to retry now.`;
    case "delegation_expiring":
    case "delegation_expired":
      return `The delegation lapses without an active continuity policy that can renew it (${finding.detail ?? "no_policy"}). Install the host policy (${INSTALL_POLICY}) or review a renewed delegation (${REVIEW_DELEGATION}).`;
    case "delegation_outside_policy":
      return `The delegation exceeds the host policy limits (${finding.detail}), so it is not renewed automatically. Review it (${REVIEW_DELEGATION}) or reinstall the policy from this delegation (${INSTALL_POLICY}).`;
    case "delegation_invalid":
      return `The delegation file fails its contract. Review a new one (${REVIEW_DELEGATION}).`;
    case "delegation_continuation_failed":
      return `${SEED_FAILURES[finding.detail ?? ""] ?? `Continuing the delegation failed (${finding.detail})`}. The resident retries every 15 minutes.`;
    case "delegation_revoked":
      return "The owner revoked this delegation; continuity never renews or reseeds it.";
    case "policy_absent":
      return `No host continuity policy is installed. A resident adopts one from the first reviewed delegation on this host, or install it now (${INSTALL_POLICY}).`;
    case "policy_invalid":
      return `The host continuity policy file fails its contract. Reinstall it (${INSTALL_POLICY}).`;
    case "policy_revoked":
      return "The owner revoked the host continuity policy; delegations lapse at their expiry.";
    case "policy_horizon_near":
      return `The host continuity policy horizon ends within 72 hours. Reinstall it to extend continuity (${INSTALL_POLICY}).`;
    case "owner_host_standalone":
      return "No Hub coordinates exist for this repository on this host, so it converges standalone. Register a Node for it (lervo repository node plan, then apply) to coordinate across hosts.";
    case "owner_host_hub_unusable":
      return `This host has Hub coordinates but they cannot coordinate this project, so it stays standalone. ${hubFailure(finding.detail)}. The resident switches to Hub mode on its next hourly cycle.`;
    case "owner_host_invalid":
      return "The owner-host configuration is invalid. Fix .lervo/state/knowledge/convergence-owner-host.json, or delete it and the resident derives it again.";
    case "lease_unverifiable":
      return `This host cannot prove convergence ownership. ${hubFailure(finding.detail)}, then run lervo knowledge convergence owner status.`;
    case "lease_contended":
      return "Two standalone hosts commit background knowledge. Register a Node for this repository on both hosts so they coordinate through the Hub.";
    case "publication_unavailable":
      return "Publication is off because this host has no authenticated gh session or no origin default branch. Run gh auth login and git remote set-head origin --auto; the resident enables it within six hours.";
    case "publication_failed":
      return "Publishing knowledge commits failed; see the knowledge_publication attention item.";
    case "hub_unavailable":
      return `Exchanging host records with the Hub failed. ${hubFailure(finding.detail)}.`;
    case "peer_delegation_missing":
      return `Host ${finding.detail} has no active delegation. Its resident seeds one from this host's scope on its next cycle; run ${DOCTOR} there if it persists.`;
    case "peer_delegation_expiring":
      return `Host ${finding.detail}'s delegation expires within 72 hours${finding.severity === "attention" ? " and it has no active continuity policy" : ""}. Run ${DOCTOR} on that host.`;
    case "peer_unreported":
      return `Host ${finding.detail} has not reported for two hours; its resident may be stopped. Run ${DOCTOR} on that host.`;
    case "continuity_unobserved":
      return "No knowledge resident has reconciled continuity for this checkout on this host yet. Register a Node for it (lervo repository node plan, then apply) or run lervo knowledge worker --watch.";
    case "continuity_stale":
      return "Continuity was last reconciled more than two hours ago, so the resident for this checkout is not running.";
    case "resident_not_running":
      return "No knowledge resident heartbeat exists for this checkout. Start its Node or lervo knowledge worker --watch.";
    case "hook_runtime_stale":
      return "The generated terminal hook runtime is older than the installed Lervo. Run lervo upgrade, then apply its plan.";
    case "replica_diverged":
      return "The Mac–WSL replica of this repository diverged; see the repository_replica_divergence attention item.";
  }
}
