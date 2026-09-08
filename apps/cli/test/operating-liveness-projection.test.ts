import type { WorkforceAgent } from "@lervo/agent-workforce";
import { describe, expect, it } from "vitest";

import {
  createOperatingLivenessReport,
  MAXIMUM_MANAGED_PROCESS_OBSERVATIONS,
  type ManagedProviderProcessObservationSource,
} from "../src/operating-liveness-projection.js";

function agent(overrides: Partial<WorkforceAgent> = {}): WorkforceAgent {
  return {
    schemaVersion: 1,
    agentId: "agt_0123456789abcdef01234567",
    projectId: "prj_0123456789abcdef",
    displayName: "Tarin",
    displayNameSource: "explicit",
    roleId: "developer",
    roleVersion: "1.0.0",
    roleContractHash: `sha256:${"a".repeat(64)}`,
    roleProfileHash: `sha256:${"b".repeat(64)}`,
    provider: "codex",
    capabilityHash: `sha256:${"c".repeat(64)}`,
    skillIds: [],
    responsibilityPaths: ["*"],
    parentAgentId: null,
    delegationDepth: 0,
    status: "active",
    revision: 1,
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
    ...overrides,
  };
}

function processObservation(
  index: number,
  overrides: Partial<ManagedProviderProcessObservationSource> = {},
): ManagedProviderProcessObservationSource {
  const coordinate = String(index).padStart(8, "0");
  return {
    eventId: `evt_process_${coordinate}`,
    sequence: index + 1,
    runId: `run_process_${coordinate}`,
    sessionId: `ses_process_${coordinate}`,
    provider: "codex",
    adapterId: "codex-app-server",
    providerSessionDigest: `sha256:${index.toString(16).padStart(64, "0")}`,
    phase: "turn_terminal",
    status: "running",
    evidence: "owned_process_state",
    observedAt: new Date(Date.UTC(2026, 8, 5, 0, 0, index)).toISOString(),
    releasesAgentAuthority: false,
    releasesAssignmentAuthority: false,
    provesWorkProgress: false,
    ...overrides,
  } as ManagedProviderProcessObservationSource;
}

describe("operating liveness projection", () => {
  it("keeps root heartbeat and managed process evidence separate without authority claims", () => {
    const root = agent();
    const child = agent({
      agentId: "agt_1123456789abcdef01234567",
      parentAgentId: root.agentId,
      delegationDepth: 1,
    });
    const report = createOperatingLivenessReport({
      projectId: root.projectId,
      agents: [child, root],
      rootAgentObservations: [
        {
          agentId: root.agentId,
          agentRevision: root.revision,
          reportingProvider: "codex",
          providerSessionDigest: `sha256:${"d".repeat(64)}`,
          observedAt: "2026-09-05T00:00:30.000Z",
        },
      ],
      managedProviderProcessObservations: [
        processObservation(1, {
          status: "unobservable",
          evidence: "transport_state_unavailable",
        }),
      ],
      observedAt: new Date("2026-09-05T00:01:00.000Z"),
    });

    expect(report.rootAgents.items).toHaveLength(1);
    expect(report.rootAgents.items[0]).toMatchObject({
      agentId: root.agentId,
      status: "recently_observed",
      releasesAgentAuthority: false,
      provesManagedProcessHealth: false,
    });
    expect(report.managedProviderProcesses.items[0]).toMatchObject({
      status: "unobservable",
      evidence: "transport_state_unavailable",
      continuity: "point_in_time_only",
      releasesAgentAuthority: false,
      releasesAssignmentAuthority: false,
      provesWorkProgress: false,
    });
    expect(report.authority).toEqual({
      releasesAgentAuthority: false,
      releasesAssignmentAuthority: false,
      startsOrStopsProvider: false,
      provesWorkProgress: false,
    });
    expect(report.limitations[0]).toContain("separate evidence");
  });

  it("reports every root state and bounds managed session detail without losing counts", () => {
    const roots = [
      agent({ agentId: "agt_0123456789abcdef01234567" }),
      agent({ agentId: "agt_1123456789abcdef01234567", revision: 2 }),
      agent({ agentId: "agt_2123456789abcdef01234567", status: "suspended" }),
    ];
    const processes = Array.from({ length: MAXIMUM_MANAGED_PROCESS_OBSERVATIONS + 2 }, (_, index) =>
      processObservation(index),
    );
    const report = createOperatingLivenessReport({
      projectId: roots[0]!.projectId,
      agents: roots,
      rootAgentObservations: [
        {
          agentId: roots[1]!.agentId,
          agentRevision: 1,
          reportingProvider: "codex",
          providerSessionDigest: `sha256:${"e".repeat(64)}`,
          observedAt: "2026-09-05T00:00:00.000Z",
        },
        {
          agentId: roots[2]!.agentId,
          agentRevision: 1,
          reportingProvider: "codex",
          providerSessionDigest: `sha256:${"f".repeat(64)}`,
          observedAt: "2026-09-05T00:00:00.000Z",
        },
      ],
      managedProviderProcessObservations: processes,
      observedAt: new Date("2026-09-05T00:10:00.000Z"),
    });

    expect(report.summary.rootAgentStatusCounts).toMatchObject({
      unobserved: 1,
      agent_revision_changed: 1,
      inactive: 1,
    });
    expect(report.managedProviderProcesses).toMatchObject({
      maximumItems: MAXIMUM_MANAGED_PROCESS_OBSERVATIONS,
      totalCount: MAXIMUM_MANAGED_PROCESS_OBSERVATIONS + 2,
      truncatedCount: 2,
    });
    expect(report.managedProviderProcesses.items).toHaveLength(
      MAXIMUM_MANAGED_PROCESS_OBSERVATIONS,
    );
    expect(report.summary.managedProviderStatusCounts.running).toBe(
      MAXIMUM_MANAGED_PROCESS_OBSERVATIONS + 2,
    );
  });

  it("validates the root liveness threshold even when no root agent exists", () => {
    expect(() =>
      createOperatingLivenessReport({
        projectId: "prj_0123456789abcdef",
        agents: [],
        rootAgentObservations: [],
        managedProviderProcessObservations: [],
        observedAt: new Date("2026-09-05T00:00:00.000Z"),
        staleAfterMs: 999,
      }),
    ).toThrow("root-agent liveness threshold is invalid");
  });
});
