import type { HostActivationRecord, HostLinkChange, HostLinkState } from "./host-cli-activation.js";
import type { HostReleasePlan, HostUpgradeResult } from "./host-upgrade.js";
import type { HostRollbackResult } from "./host-upgrade-rollback.js";

const reconciledLine = (ids: string[]): string =>
  ids.length === 0
    ? ""
    : `Settled ${ids.length} unfinished activation(s) left by a crashed run (restored or abandoned; see --status): ${ids.join(", ")}.\n`;

const linkLines = (links: HostLinkChange[]): string =>
  links
    .map(
      (link) => `  ${link.name}: ${link.previous ?? "(none)"} -> ${link.current ?? "(removed)"}\n`,
    )
    .join("");

export function formatHostReleasePlan(plan: HostReleasePlan): string {
  const shadow =
    plan.pathShadow === null
      ? ""
      : `  warning: ${plan.pathShadow} comes earlier on PATH and would still run instead of the activated link.\n`;
  const header = `Host upgrade plan (${plan.status}): ${plan.tag} from ${plan.repository}\n  commit ${plan.commit}, tree ${plan.tree}\n  install: ${plan.installDirectory}\n${shadow}`;
  return plan.status === "current"
    ? `${header}This host already runs ${plan.tag}. Nothing was changed.\n`
    : `${header}${linkLines(plan.links)}Run again with --apply to download, verify, install, and switch. Nothing was changed.\n`;
}

export function formatHostUpgradeResult(result: HostUpgradeResult): string {
  if (result.status === "current")
    return `${reconciledLine(result.reconciledActivations)}This host already runs ${result.tag} from ${result.installDirectory}. No links changed.\n`;
  const release = result.activation.release;
  const pruned =
    result.pruned.length === 0
      ? ""
      : `Removed ${result.pruned.length} unreferenced release directories.\n`;
  return (
    reconciledLine(result.reconciledActivations) +
    `Activated ${release?.tag ?? "release"} (activation ${result.activation.activationId}).\n` +
    linkLines(result.activation.links) +
    pruned +
    `Roll back with: lervo host upgrade --rollback ${result.activation.activationId} --apply\n`
  );
}

export function formatHostRollbackResult(result: HostRollbackResult): string {
  if (result.status === "rolled_back" && result.links.length === 0)
    return `${reconciledLine(result.reconciledActivations)}Activation ${result.rolledBackActivationId} has no links left to restore. Nothing was changed.\n`;
  return result.status === "ready"
    ? `Rollback plan for activation ${result.rolledBackActivationId}:\n${linkLines(result.links)}Run again with --apply to restore these links. Nothing was changed.\n`
    : `${reconciledLine(result.reconciledActivations)}Rolled back activation ${result.rolledBackActivationId} (activation ${result.activation?.activationId ?? "unknown"}).\n${linkLines(result.links)}`;
}

function activationLine(record: HostActivationRecord): string {
  const subject =
    record.kind === "release"
      ? (record.release?.tag ?? "release")
      : `rollback of ${record.rolledBackActivationId ?? "unknown"}`;
  return `  ${record.activationId}  ${record.activatedAt}  ${subject} (${record.outcome})\n`;
}

export function formatHostUpgradeStatus(status: {
  links: HostLinkState[];
  activations: HostActivationRecord[];
}): string {
  const links = status.links
    .map(
      (link) =>
        `  ${link.name}: ${link.state === "unmanaged" ? "(not a symbolic link; not managed)" : (link.target ?? "(none)")}\n`,
    )
    .join("");
  const activations =
    status.activations.length === 0
      ? "  (none)\n"
      : [...status.activations].reverse().map(activationLine).join("");
  return `Executable links:\n${links}Retained activations, newest first:\n${activations}`;
}
