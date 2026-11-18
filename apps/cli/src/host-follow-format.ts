import type { HostFollowCycleResult } from "./host-follow-cycle.js";
import type { HostFollowInspection, HostFollowStatus } from "./host-follow-inspection.js";
import type { FollowServiceDefinition, HostFollowServicePlan } from "./host-follow-service.js";
import type { HostFollowControl, HostFollowPass } from "./host-follow-state.js";

function passLines(pass: HostFollowPass | null): string[] {
  if (pass === null) return [];
  return [
    `repositories (${pass.version ?? "unknown CLI"}): ${pass.outcome}`,
    ...pass.repositories.map(
      (repository) =>
        `  ${repository.repositoryRoot}: ${repository.outcome}${
          repository.code === null ? "" : ` (${repository.code})`
        }${repository.pendingStages.length === 0 ? "" : `, pending ${repository.pendingStages.join(", ")}`}`,
    ),
  ];
}

function controlLine(control: HostFollowControl): string {
  if (control.paused) return "following: paused (lervo host upgrade --follow --resume)";
  if (control.pinnedTag !== null) return `following: pinned to ${control.pinnedTag}`;
  return "following: newest published release";
}

function serviceDefinitionLine(definition: FollowServiceDefinition): string {
  if (definition === "definition_outdated")
    return "service definition: outdated (definition_outdated); when no pass is in flight, run lervo host upgrade --follow --service install --apply";
  if (definition === "node_changed")
    return "service definition: current for the Node it was installed with (node_changed); this shell runs another Node, and reinstalling from it would move the follower to that Node";
  if (definition === "not_installed") return "service definition: not installed";
  return `service definition: ${definition ?? "unknown"}`;
}

export function formatFollowCycle(result: HostFollowCycleResult): string {
  return `${[
    `Follow cycle: ${result.outcome}${result.tag === null ? "" : ` ${result.tag}`}${
      result.code === null ? "" : ` (${result.code})`
    }`,
    ...(result.activationId === null ? [] : [`activation: ${result.activationId}`]),
    ...(result.precededBy === null
      ? []
      : [
          `after: ${result.precededBy.outcome}${
            result.precededBy.yielded ? ", stopped at a repository boundary for this release" : ""
          }`,
        ]),
    ...passLines(result.pass),
    ...(result.handover ? ["The follower hands over to the active CLI."] : []),
  ].join("\n")}\n`;
}

export function formatFollowInspection(
  inspection: HostFollowInspection,
  serviceDefinition: FollowServiceDefinition,
): string {
  return `${[
    `Follow plan for ${inspection.repository}: ${inspection.next}${
      inspection.tag === null ? "" : ` ${inspection.tag}`
    }${inspection.code === null ? "" : ` (${inspection.code})`}`,
    `active CLI: ${inspection.activeVersion ?? "unknown"}`,
    controlLine(inspection.control),
    serviceDefinitionLine(serviceDefinition),
    "Nothing was changed. Run with --apply to follow, or install the service with --service install --apply.",
  ].join("\n")}\n`;
}

export function formatFollowStatus(status: HostFollowStatus): string {
  const { state } = status;
  return `${[
    `active CLI: ${status.activeVersion ?? "unknown"}`,
    controlLine(status.control),
    `service: ${
      status.service === null
        ? "unknown"
        : status.service.active
          ? "active"
          : status.service.installed
            ? "installed, inactive"
            : "not installed"
    }`,
    serviceDefinitionLine(status.serviceDefinition),
    `last check: ${state.lastCheckAt ?? "never"}${
      state.lastSeenTag === null ? "" : `, newest ${state.lastSeenTag}`
    }`,
    ...(state.lastOutcome === null
      ? []
      : [
          `last outcome: ${state.lastOutcome.outcome}${
            state.lastOutcome.code === null ? "" : ` (${state.lastOutcome.code})`
          } at ${state.lastOutcome.at}`,
        ]),
    ...(state.inFlight === null
      ? []
      : [`in flight: ${state.inFlight.tag} (${state.inFlight.activationId})`]),
    ...state.failedTags.map(
      (entry) => `failed on this host: ${entry.tag} (${entry.code}) at ${entry.failedAt}`,
    ),
    ...status.holds.map(
      (hold) =>
        `held by the owner: ${hold.repositoryRoot} since ${hold.heldAt}${hold.reason === null ? "" : ` (${hold.reason})`}`,
    ),
    ...passLines(state.lastPass),
  ].join("\n")}\n`;
}

export function formatFollowControl(control: HostFollowControl): string {
  return `${controlLine(control)}\n`;
}

export function formatFollowService(
  plan: HostFollowServicePlan & { change?: string },
  applied: boolean,
): string {
  return `${[
    `Follower service ${plan.serviceIdentity} (${plan.manager}): ${
      applied ? (plan.change ?? plan.action) : `would ${plan.action}`
    }`,
    `configuration: ${plan.configAction}`,
    ...(plan.blocker === null ? [] : [`blocked [${plan.blocker.code}]: ${plan.blocker.message}`]),
    ...(applied ? [] : ["Nothing was changed. Run with --apply to change it."]),
  ].join("\n")}\n`;
}
