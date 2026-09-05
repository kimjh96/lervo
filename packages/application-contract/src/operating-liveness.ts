export type OperatingRootAgentLivenessStatusV1 =
  "inactive" | "unobserved" | "agent_revision_changed" | "recently_observed" | "stale_observation";

export interface OperatingRootAgentLivenessV1 {
  schemaVersion: 1;
  agentId: string;
  agentRevision: number;
  agentStatus: "active" | "suspended" | "retired";
  configuredProvider: "codex" | "claude" | "any";
  status: OperatingRootAgentLivenessStatusV1;
  latestObservedAt: string | null;
  reportingProvider: "codex" | "claude" | null;
  providerSessionDigest: string | null;
  ageMs: number | null;
  staleAfterMs: number;
  releasesAgentAuthority: false;
  provesManagedProcessHealth: false;
}

export interface OperatingManagedProviderProcessObservationV1 {
  schemaVersion: 1;
  eventId: string;
  sequence: number;
  runId: string;
  sessionId: string;
  adapterId: string;
  provider: string;
  providerSessionDigest: string;
  phase: "session_started" | "turn_terminal" | "before_stop";
  status: "running" | "exited" | "unobservable";
  evidence: "owned_process_state" | "transport_state_unavailable" | "no_managed_process";
  observedAt: string;
  continuity: "point_in_time_only";
  releasesAgentAuthority: false;
  releasesAssignmentAuthority: false;
  provesWorkProgress: false;
}

export interface OperatingLivenessReportV1 {
  schemaVersion: 1;
  kind: "operating_liveness.report";
  projectId: string;
  observedAt: string;
  reportDigest: string;
  rootAgents: {
    source: "agent.liveness.observed";
    staleAfterMs: number;
    items: OperatingRootAgentLivenessV1[];
  };
  managedProviderProcesses: {
    source: "provider.process.observed";
    semantics: "latest_point_in_time_observation_per_provider_session";
    maximumItems: number;
    totalCount: number;
    truncatedCount: number;
    items: OperatingManagedProviderProcessObservationV1[];
  };
  summary: {
    rootAgentCount: number;
    rootAgentStatusCounts: Record<OperatingRootAgentLivenessStatusV1, number>;
    managedProviderSessionCount: number;
    managedProviderStatusCounts: Record<"running" | "exited" | "unobservable", number>;
  };
  authority: {
    releasesAgentAuthority: false;
    releasesAssignmentAuthority: false;
    startsOrStopsProvider: false;
    provesWorkProgress: false;
  };
  limitations: string[];
}
