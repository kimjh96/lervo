import { describe, expect, it } from "vitest";

import {
  createRootAgentLivenessObservation,
  observeRootAgentLiveness,
  type WorkforceAgent,
} from "../src/index.js";

function agent(overrides: Partial<WorkforceAgent> = {}): WorkforceAgent {
  return {
    schemaVersion: 1,
    agentId: `agt_${"a".repeat(24)}`,
    projectId: "prj_agent_liveness",
    roleId: "developer",
    roleVersion: "1.0.0",
    roleContractHash: `sha256:${"b".repeat(64)}`,
    roleProfileHash: `sha256:${"c".repeat(64)}`,
    provider: "codex",
    capabilityHash: `sha256:${"d".repeat(64)}`,
    skillIds: [],
    responsibilityPaths: ["*"],
    parentAgentId: null,
    delegationDepth: 0,
    status: "active",
    revision: 3,
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
    ...overrides,
  };
}

describe("root-agent liveness", () => {
  it("creates a domain-separated report without retaining the provider session ID", () => {
    const observation = createRootAgentLivenessObservation({
      agent: agent(),
      expectedRevision: 3,
      reportingProvider: "codex",
      providerSessionId: "ses_private_runtime_01",
      observedAt: new Date("2026-09-05T00:01:00.000Z"),
    });
    expect(observation).toMatchObject({
      agentRevision: 3,
      reportingProvider: "codex",
      observedAt: "2026-09-05T00:01:00.000Z",
      providerSessionDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(JSON.stringify(observation)).not.toContain("ses_private_runtime_01");
  });

  it("rejects child, inactive, stale-revision, and provider-mismatched reports", () => {
    const common = {
      expectedRevision: 3,
      reportingProvider: "codex" as const,
      providerSessionId: "ses_private_runtime_01",
      observedAt: new Date("2026-09-05T00:01:00.000Z"),
    };
    expect(() =>
      createRootAgentLivenessObservation({
        ...common,
        agent: agent({ parentAgentId: `agt_${"e".repeat(24)}`, delegationDepth: 1 }),
      }),
    ).toThrow("child agent");
    expect(() =>
      createRootAgentLivenessObservation({ ...common, agent: agent({ status: "suspended" }) }),
    ).toThrow("exact active");
    expect(() =>
      createRootAgentLivenessObservation({ ...common, agent: agent(), expectedRevision: 2 }),
    ).toThrow("exact active");
    expect(() =>
      createRootAgentLivenessObservation({
        ...common,
        agent: agent({ provider: "claude" }),
      }),
    ).toThrow("provider authority");
  });

  it("separates recent, stale, revision-changed, unobserved, and inactive states", () => {
    const current = agent();
    const observation = createRootAgentLivenessObservation({
      agent: current,
      expectedRevision: 3,
      reportingProvider: "codex",
      providerSessionId: "ses_private_runtime_01",
      observedAt: new Date("2026-09-05T00:01:00.000Z"),
    });
    const inspect = (overrides: Partial<Parameters<typeof observeRootAgentLiveness>[0]> = {}) =>
      observeRootAgentLiveness({
        agent: current,
        observations: [observation],
        observedAt: new Date("2026-09-05T00:02:00.000Z"),
        staleAfterMs: 120_000,
        ...overrides,
      });
    expect(inspect()).toMatchObject({
      status: "recently_observed",
      ageMs: 60_000,
      releasesAgentAuthority: false,
      provesManagedProcessHealth: false,
    });
    expect(inspect({ observedAt: new Date("2026-09-05T00:04:00.001Z") }).status).toBe(
      "stale_observation",
    );
    expect(inspect({ agent: agent({ revision: 4 }) }).status).toBe("agent_revision_changed");
    expect(inspect({ observations: [] }).status).toBe("unobserved");
    expect(inspect({ agent: agent({ status: "suspended" }) }).status).toBe("inactive");
  });
});
