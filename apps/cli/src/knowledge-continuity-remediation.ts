import type { ContinuityFinding } from "@lervo/repository-knowledge-runtime";

import { eventWriterBlocker } from "./event-writer-activation-blockers.js";
import { TARGET_EVENT_SCHEMA_VERSION } from "./event-writer-target.js";

/**
 * ADR-0561: continuity Lervo cannot restore within the last installed policy bounds is Lervo's
 * own debt. These remediations say what Lervo does next and never assign the owner a step.
 */
const DEBT = "Lervo debt";
const DOCTOR = "lervo knowledge convergence doctor";

const SEED_FAILURES: Record<string, string> = {
  convergence_seed_parent_missing:
    "No local agent can answer for the peer's scope. Register the parent role with lervo agent hire; the resident seeds on its next cycle",
  convergence_seed_role_mismatch:
    "This host resolves the peer's role pins to different hashes. Run the same Lervo version on both hosts (lervo upgrade)",
  convergence_seed_roots_missing:
    "None of the template's canonical or normalization roots exist in this checkout, so the resident cannot seed from it and retries when a root appears",
  convergence_seed_verification_missing:
    "The repository has no verification suite to bind. The resident installs Lervo's default suite, .lervo/verifications/lervo.default.knowledge.yaml, which runs lervo knowledge lint, and seeds on its next cycle; a resident older than ADR-0655 needs the host upgraded. Add your own .lervo/verifications/repository.default.v1.yaml to verify more",
  convergence_seed_verification_ambiguous:
    "The repository has several verification suites and none named repository.default, so Lervo cannot tell which one verifies its knowledge changes and installs no default beside them. Rename the suite to bind to .lervo/verifications/repository.default.v1.yaml; the resident seeds on its next cycle",
  convergence_seed_definition_unavailable:
    "The peer's scope binds a verification suite or asset manifest this checkout lacks, and no host has shared the exact reviewed bytes through the Hub yet. The peer shares them on its next reconciliation once both the Hub and that host run an ADR-0477 version; see the definition_exchange_unavailable finding if one is reported",
  convergence_seed_definition_conflict:
    "This checkout has its own different file where the peer's scope binds a verification suite, role, or asset manifest, and Lervo never overwrites a file it did not install. Compare the file with the peer's copy: delete or rename yours to accept the reviewed one",
  convergence_seed_identity_mismatch:
    "The peer's delegation names another repository identity. Check that both checkouts share one .lervo/project.json",
  knowledge_authority_unavailable:
    "This host holds no delegation that passes its role, suite, and ancestry checks. A repository that was never seeded reports why under its convergence_seed_* finding, such as a missing verification suite, which the resident fixes itself; otherwise the bound scope changed and the resident seeds again on its next cycle",
  knowledge_reader_transition_required:
    "This checkout's event store still writes a schema older than 4. Run lervo upgrade on this host",
  knowledge_plan_stale:
    "The delegation changed while it was continued. The resident retries on its next cycle; nothing else is needed",
  convergence_continuity_horizon_exhausted:
    "The continuity policy horizon has ended; the resident rolls it forward within the same limits on its next cycle",
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
      return finding.severity === "lervo_debt"
        ? `${DEBT}: another host converges this repository, but this host has no delegation and no continuity policy to seed one. The first delegation installed on this host also installs the policy, and every resident on this host then seeds itself.`
        : finding.severity === "info"
          ? "No host has delegated background knowledge for this repository, so it is not enrolled."
          : `${SEED_FAILURES[finding.detail ?? ""] ?? "The resident seeds a delegation on its next cycle"}. Run lervo knowledge convergence delegation seed to retry now.`;
    case "delegation_expiring":
    case "delegation_expired":
      return finding.severity === "lervo_debt"
        ? `${DEBT}: no active continuity policy can renew the delegation (${finding.detail ?? "no_policy"}). The resident adopts a policy from the active delegation and renews it within those limits; a lapsed delegation stays held until a policy or a peer scope can seed it.`
        : "The delegation lapsed, and the resident renews it within the installed policy limits on its next cycle.";
    case "delegation_outside_policy":
      return `${DEBT}: the delegation shares no provider with the host policy limits (${finding.detail}), so no renewal within those limits exists. It stays held until the delegation or the policy changes.`;
    case "delegation_invalid":
      return `${DEBT}: the delegation file fails its contract, so the resident holds this checkout's background knowledge. The next delegation installed here replaces it.`;
    case "delegation_continuation_failed":
      return `${SEED_FAILURES[finding.detail ?? ""] ?? `Continuing the delegation failed (${finding.detail})`}. The resident retries every 15 minutes.`;
    case "delegation_revoked":
      return "The owner revoked this delegation; continuity never renews or reseeds it.";
    case "policy_absent":
      return "No host continuity policy is installed. A resident adopts one from the first reviewed delegation on this host.";
    case "policy_invalid":
      return `${DEBT}: the host continuity policy file fails its contract, so delegations on this host renew only once a valid policy is installed or adopted.`;
    case "policy_revoked":
      return "The owner revoked the host continuity policy; delegations lapse at their expiry.";
    case "policy_horizon_near":
      return "The host continuity policy horizon ends soon. The resident rolls it forward within the same limits on its next reconciliation.";
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
    case "resident_cycle_failed":
      return `The latest knowledge resident cycle failed (${finding.detail ?? "unclassified_failure"}). Run ${DOCTOR} --json to inspect lastFailure. The resident retries automatically.`;
    case "host_resident_scan_stalled":
      return "The host knowledge resident keeps its heartbeat, but its repository scan has not finished for over ten minutes; knowledge-host-resident.json in the Lervo user state directory names the checkout it is opening. Restart the service (launchctl kickstart -k gui/$UID/com.lervo.knowledge.host, or systemctl --user restart lervo-knowledge-host.service) and report the named checkout if it recurs.";
    case "continuity_pending":
      return "The host knowledge resident serves this checkout and reconciles it on its next cycle; nothing is needed.";
    case "event_schema_outdated":
      return `This checkout's event writer is older than schema 4, so its knowledge resident is held. Run lervo upgrade and apply its plan: it backs up the event store and activates schema ${TARGET_EVENT_SCHEMA_VERSION}. The host resident activates local-only checkouts itself and retries every 30 minutes.${finding.detail === null ? "" : ` Current blocker (${finding.detail}): ${eventWriterBlocker({ code: finding.detail }, TARGET_EVENT_SCHEMA_VERSION).message}`}`;
    case "hook_runtime_unavailable":
      return "The host terminal hook runtime is unavailable. The host resident restores and verifies it on its next cycle. If repair keeps failing, restore write access to the host runtime store.";
    case "replica_diverged":
      return "The Mac–WSL replica of this repository diverged; see the repository_replica_divergence attention item.";
    case "convergence_attention":
      return finding.detail === "knowledge_sources_parked"
        ? "Background knowledge finished everything except parked sources. lervo knowledge convergence status --json lists them: edit a parked source to readmit it; a target_diverged source is also readmitted when its integration-target bytes change."
        : "Background knowledge convergence on this host stopped for this cause. lervo knowledge convergence status --json names the stage; the resident retries once the cause changes.";
  }
}
