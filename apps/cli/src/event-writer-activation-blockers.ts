import type { UpgradeStageBlocker } from "./upgrade-stage-inspection.js";

const nodeHealth = (target: number) =>
  `Keep the registered repository Node running on a release that reads event schema ${target} until \`lervo repository node status --json\` reports health younger than two minutes, then rerun \`lervo upgrade\`.`;
const NODE_REGISTRATION =
  "Reconcile this repository's Node registration (`lervo repository node plan`, then apply it), or retire a stale registration, then rerun `lervo upgrade`.";

/**
 * The exact remedy for each closed activation blocker, for activation up to `target`; unknown
 * codes get the generic step.
 */
const remedies = (target: number): Record<string, string> => ({
  terminal_hook_reader_stale:
    "The terminal hook reader is not ready. The host resident restores the installed host runtime automatically. A legacy repository bundle must first migrate to the tracked launcher through the generated-only terminal_integration stage; provider changes retain their exact approval.",
  reader_inventory_node_health_unavailable: nodeHealth(target),
  reader_inventory_node_health_stale: nodeHealth(target),
  reader_inventory_node_identity_mismatch: NODE_REGISTRATION,
  reader_inventory_fleet_unavailable: NODE_REGISTRATION,
  reader_inventory_service_unavailable: NODE_REGISTRATION,
  reader_inventory_config_invalid: NODE_REGISTRATION,
  reader_inventory_hub_unavailable: `Start the configured Hub, or make it reachable from this host, on a release that reads event schema ${target}, then rerun \`lervo upgrade\`. Do not disable Hub synchronization to bypass this gate.`,
  reader_inventory_incomplete:
    "The reader inventory must be exactly the local runtime, the registered Node, and the configured Hub. Reconcile the Node registration, then rerun `lervo upgrade`.",
  reader_inventory_authority_unavailable: NODE_REGISTRATION,
  unexpected_remote_reader:
    "A local-only checkout reported remote readers. Check `.lervo/project.json` dataPolicy.hubSyncEnabled, then rerun `lervo upgrade`.",
  event_writer_activation_blocked: `A configured reader cannot read event schema ${target}. Upgrade that Hub or Node to this CLI's release, then rerun \`lervo upgrade\`.`,
  event_writer_recovery_required:
    "An earlier activation was interrupted. Run `lervo event-contract recover`, then rerun `lervo upgrade`.",
  event_writer_coordinate_invalid:
    "`.lervo/data/event-contract.json` fails its contract. Restore it from `.lervo/data/event-writer-backups/` or run `lervo event-contract recover`.",
  event_writer_evidence_invalid:
    "The reader evidence failed its contract. Rerun `lervo upgrade`; report the code if it persists.",
  event_writer_plan_stale:
    "Readers or the writer coordinate changed while the upgrade ran. Rerun `lervo upgrade` and apply the new plan.",
  event_writer_backup_failed:
    "The event database could not be copied before activation, so nothing was activated. Free disk space or fix `.lervo/data` permissions, then rerun `lervo upgrade`.",
});

function codeOf(value: unknown): string {
  const code = (value as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,127}$/u.test(code)
    ? code
    : "event_writer_activation_failed";
}

/**
 * Translates an activation failure or plan blocker into a bounded upgrade blocker with remedy,
 * naming `targetSchemaVersion`, the version the activation needs every reader to read.
 */
export function eventWriterBlocker(
  value: unknown,
  targetSchemaVersion: number,
): UpgradeStageBlocker {
  const code = codeOf(value);
  return {
    code,
    message:
      remedies(targetSchemaVersion)[code] ??
      "Event writer activation failed. Rerun `lervo upgrade`; if it persists, follow docs/foundation/event-writer-rollout/activation.md.",
  };
}
