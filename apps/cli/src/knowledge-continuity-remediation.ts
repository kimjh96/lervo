import type { ContinuityFinding } from "@lervo/repository-knowledge-runtime";

import { eventWriterBlocker } from "./event-writer-activation-blockers.js";

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
  convergence_seed_definition_unavailable:
    "The peer's scope binds a verification suite or asset manifest this checkout lacks, and no host has shared the exact reviewed bytes through the Hub yet. The peer shares them on its next reconciliation once both the Hub and that host run an ADR-0477 version; see the definition_exchange_unavailable finding if one is reported",
  convergence_seed_definition_conflict:
    "This checkout has its own different file where the peer's scope binds a verification suite, role, or asset manifest, and Lervo never overwrites a file it did not install. Compare the file with the peer's copy: delete or rename yours to accept the reviewed one, or review a delegation that binds yours",
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
    "The Hub refused this host's credential for this project. Hub credentials are scoped per project: place this project's own credential at nodes/<projectId>/secrets/hub-sync.token in the Lervo user state directory (or ~/.config/lervo/nodes on Linux), upgrade the Hub to an ADR-0469 version so a credential with sync.write coordinates knowledge for its projects, or add this project to the credential's projects",
  hub_unauthorized:
    "The Hub did not accept the token in this host's Node configuration. Replace it with a current credential",
  hub_unreachable: "The Hub did not answer. Check that it runs and is reachable from this host",
  hub_identity_mismatch:
    "The answering service is not the configured Hub. Compare hubIdentityHash with the Hub's identity",
  hub_response_invalid:
    "The Hub answered unexpectedly. Upgrade it to a version with ADR-0469 host records",
  hub_configuration_invalid: "The Hub coordinates or token cannot form a request. Fix them",
  hub_definitions_unsupported:
    "The Hub predates ADR-0477 and cannot carry delegation-bound definitions. Upgrade the Hub; host records keep working meanwhile",
  token_file_unreadable: "Make the Hub bearer token file an owner-only (0600) regular file",
};

/** ADR-0470: the next step for a checkout no resident has reconciled, by who should host it. */
const RESIDENT_HOSTS: Record<string, string> = {
  node_served:
    "Its registered Node should run this checkout's resident. Check lervo repository node status --json and restart the Node if its health is stale.",
  host_resident_absent:
    "No Node serves this checkout and no host knowledge resident runs on this host. Run lervo upgrade and apply its plan; its host_service stage installs the host resident service.",
  host_resident_unlisted:
    "The host knowledge resident runs but does not list this checkout. Register it with lervo repository register --write; the resident serves it within five minutes.",
};

function residentHost(detail: string | null, fallback: string): string {
  return (detail === null ? undefined : RESIDENT_HOSTS[detail]) ?? fallback;
}

function hubFailure(detail: string | null): string {
  return (detail === null ? undefined : HUB_FAILURES[detail]) ?? "Check the Hub configuration";
}

/** The exact next step for one continuity finding; the system retries everything else itself. */
export function continuityRemediation(finding: ContinuityFinding): string {
  switch (finding.code) {
    case "provider_cli_detected":
    case "provider_cli_admitted":
      return "Provider admission follows the installed executable identity and rechecks changes before use.";
    case "provider_cli_rejected":
      return `The installed CLI failed its no-capability contract (${finding.detail}). Provider admission retries detection and uses an admitted allowed provider when available.`;
    case "provider_detection_failed":
      return `The login-shell lookup failed (${finding.detail}); provider admission continues with well-known install locations and retries detection.`;
    case "provider_not_admitted":
      if (finding.detail?.includes(":paused:"))
        return "Provider admission re-probes a pause without a reset time after its backoff, when delegation allows that candidate. A known reset keeps its exact expiry.";
      return "No allowed installed provider passes the no-capability contract. Provider admission retries detection; background work resumes when a provider is admitted.";
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
      return `This host has Hub coordinates but they cannot coordinate this project, so it stays read-only: it never owns standalone while another host may hold the Hub lease. ${hubFailure(finding.detail)}. The resident re-probes on every reconciliation and resumes as soon as coordination works.`;
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
    case "definition_exchange_unavailable":
      return `Sharing the definitions a delegation binds through the Hub failed, so a host that lacks a bound suite or role cannot seed. ${hubFailure(finding.detail)}. The resident retries on every reconciliation.`;
    case "peer_delegation_missing":
      return `Host ${finding.detail} has no active delegation. Its resident seeds one from this host's scope on its next cycle; run ${DOCTOR} there if it persists.`;
    case "peer_delegation_expiring":
      return `Host ${finding.detail}'s delegation expires within 72 hours${finding.severity === "attention" ? " and it has no active continuity policy" : ""}. Run ${DOCTOR} on that host.`;
    case "peer_unreported":
      return `Host ${finding.detail} has not reported for two hours; its resident may be stopped. Run ${DOCTOR} on that host.`;
    case "continuity_unobserved":
      return `No knowledge resident has reconciled continuity for this checkout on this host yet. ${residentHost(finding.detail, "Run lervo upgrade and apply its plan to install the host resident service, or register a Node for it.")}`;
    case "continuity_stale":
      return `Continuity was last reconciled more than two hours ago, so the resident for this checkout is not running. ${residentHost(finding.detail, "Run lervo knowledge convergence doctor again after the host resident's next scan.")}`;
    case "resident_not_running":
      return `No knowledge resident heartbeat exists for this checkout. ${residentHost(finding.detail, "Start its Node, or run lervo upgrade to install the host resident service.")}`;
    case "host_resident_scan_stalled":
      return "The host knowledge resident keeps its heartbeat, but its repository scan has not finished for over ten minutes; knowledge-host-resident.json in the Lervo user state directory names the checkout it is opening. Restart the service (launchctl kickstart -k gui/$UID/com.lervo.knowledge.host, or systemctl --user restart lervo-knowledge-host.service) and report the named checkout if it recurs.";
    case "continuity_pending":
      return "The host knowledge resident serves this checkout and reconciles it on its next cycle; nothing is needed.";
    case "event_schema_outdated":
      return `This checkout's event writer is older than schema 4, so its knowledge resident is held. Run lervo upgrade and apply its plan: it backs up the event store and activates schema 4. The host resident activates local-only checkouts itself and retries every 30 minutes.${finding.detail === null ? "" : ` Current blocker (${finding.detail}): ${eventWriterBlocker({ code: finding.detail }).message}`}`;
    case "hook_runtime_stale":
      return "The generated terminal hook runtime is older than the installed Lervo. Run lervo upgrade, then apply its plan.";
    case "replica_diverged":
      return "The Mac–WSL replica of this repository diverged; see the repository_replica_divergence attention item.";
  }
}
