import {
  observeRootAgentLiveness,
  resolveRootAgentLivenessStaleAfterMs,
  type RootAgentLivenessObservation,
  type WorkforceAgent,
} from "@lervo/agent-workforce";
import type {
  OperatingLivenessReportV1,
  OperatingManagedProviderProcessObservationV1,
  OperatingRootAgentLivenessStatusV1,
} from "@lervo/application-contract";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import type { ProviderProcessObservedEventPayload } from "@lervo/schemas";

export const MAXIMUM_MANAGED_PROCESS_OBSERVATIONS = 256;

export type ManagedProviderProcessObservationSource = ProviderProcessObservedEventPayload & {
  eventId: string;
  sequence: number;
  runId: string;
  sessionId: string;
  provider: string;
};

const ROOT_STATUSES: OperatingRootAgentLivenessStatusV1[] = [
  "inactive",
  "unobserved",
  "agent_revision_changed",
  "recently_observed",
  "stale_observation",
];

function rootStatusCounts(
  items: OperatingLivenessReportV1["rootAgents"]["items"],
): OperatingLivenessReportV1["summary"]["rootAgentStatusCounts"] {
  return Object.fromEntries(
    ROOT_STATUSES.map((status) => [status, items.filter((item) => item.status === status).length]),
  ) as OperatingLivenessReportV1["summary"]["rootAgentStatusCounts"];
}

function managedStatusCounts(
  items: ManagedProviderProcessObservationSource[],
): OperatingLivenessReportV1["summary"]["managedProviderStatusCounts"] {
  return {
    running: items.filter((item) => item.status === "running").length,
    exited: items.filter((item) => item.status === "exited").length,
    unobservable: items.filter((item) => item.status === "unobservable").length,
  };
}

function managedItem(
  source: ManagedProviderProcessObservationSource,
): OperatingManagedProviderProcessObservationV1 {
  return {
    schemaVersion: 1,
    eventId: source.eventId,
    sequence: source.sequence,
    runId: source.runId,
    sessionId: source.sessionId,
    adapterId: source.adapterId,
    provider: source.provider,
    providerSessionDigest: source.providerSessionDigest,
    phase: source.phase,
    status: source.status,
    evidence: source.evidence,
    observedAt: source.observedAt,
    continuity: "point_in_time_only",
    releasesAgentAuthority: false,
    releasesAssignmentAuthority: false,
    provesWorkProgress: false,
  };
}

export function createOperatingLivenessReport(input: {
  projectId: string;
  agents: WorkforceAgent[];
  rootAgentObservations: RootAgentLivenessObservation[];
  managedProviderProcessObservations: ManagedProviderProcessObservationSource[];
  observedAt: Date;
  staleAfterMs?: number;
}): OperatingLivenessReportV1 {
  const staleAfterMs = resolveRootAgentLivenessStaleAfterMs(input.staleAfterMs);
  const roots = input.agents
    .filter((agent) => agent.parentAgentId === null)
    .sort((left, right) => left.agentId.localeCompare(right.agentId))
    .map((agent) => {
      const liveness = observeRootAgentLiveness({
        agent,
        observations: input.rootAgentObservations,
        observedAt: input.observedAt,
        staleAfterMs,
      });
      return {
        schemaVersion: 1 as const,
        agentId: agent.agentId,
        agentRevision: agent.revision,
        agentStatus: agent.status,
        configuredProvider: agent.provider,
        status: liveness.status,
        latestObservedAt: liveness.latestObservedAt,
        reportingProvider: liveness.reportingProvider,
        providerSessionDigest: liveness.providerSessionDigest,
        ageMs: liveness.ageMs,
        staleAfterMs: liveness.staleAfterMs,
        releasesAgentAuthority: false as const,
        provesManagedProcessHealth: false as const,
      };
    });
  const latestProcesses = [...input.managedProviderProcessObservations].sort(
    (left, right) =>
      Date.parse(right.observedAt) - Date.parse(left.observedAt) ||
      right.sequence - left.sequence ||
      left.providerSessionDigest.localeCompare(right.providerSessionDigest),
  );
  const processItems = latestProcesses
    .slice(0, MAXIMUM_MANAGED_PROCESS_OBSERVATIONS)
    .map(managedItem);
  const digestInput = {
    projectId: input.projectId,
    observedAt: input.observedAt.toISOString(),
    roots,
    latestProcesses,
  };
  return {
    schemaVersion: 1,
    kind: "operating_liveness.report",
    projectId: input.projectId,
    observedAt: digestInput.observedAt,
    reportDigest: sha256(canonicalJson(digestInput)),
    rootAgents: {
      source: "agent.liveness.observed",
      staleAfterMs,
      items: roots,
    },
    managedProviderProcesses: {
      source: "provider.process.observed",
      semantics: "latest_point_in_time_observation_per_provider_session",
      maximumItems: MAXIMUM_MANAGED_PROCESS_OBSERVATIONS,
      totalCount: latestProcesses.length,
      truncatedCount: latestProcesses.length - processItems.length,
      items: processItems,
    },
    summary: {
      rootAgentCount: roots.length,
      rootAgentStatusCounts: rootStatusCounts(roots),
      managedProviderSessionCount: latestProcesses.length,
      managedProviderStatusCounts: managedStatusCounts(latestProcesses),
    },
    authority: {
      releasesAgentAuthority: false,
      releasesAssignmentAuthority: false,
      startsOrStopsProvider: false,
      provesWorkProgress: false,
    },
    limitations: [
      "Root-agent heartbeat and managed-provider process observations are separate evidence and are never joined into a health claim.",
      "A provider-process item is only the latest recorded point-in-time observation for its opaque session digest; age or silence proves no current process state.",
      "Unobserved, stale, revision-changed, exited, and unobservable results release no agent, assignment, lease, workspace-writer, or provider authority.",
      "This read-only report starts no polling, scheduler, provider process, recovery, or external effect.",
    ],
  };
}
