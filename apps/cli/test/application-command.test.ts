import { describe, expect, it } from "vitest";

import { runApplicationCommand } from "../src/application-command.js";
import { createProductHostCapabilityReport } from "../src/product-host-capabilities.js";

function io() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    value: {
      cwd: "/repository",
      stdout: (message: string) => stdout.push(message),
      stderr: (message: string) => stderr.push(message),
    },
  };
}

describe("application command", () => {
  it("reports the versioned local product-host boundary as JSON", async () => {
    const output = io();

    expect(await runApplicationCommand(["capabilities", "--json"], output.value)).toBe(0);
    const report = JSON.parse(output.stdout.join(""));
    expect(report).toEqual(createProductHostCapabilityReport());
    expect(report.protocol).toEqual({
      transport: "local_cli",
      version: 1,
      discoveryCommand: ["application", "capabilities", "--json"],
      requiresHub: false,
    });
    expect(report.routes.map((route: { routeId: string }) => route.routeId)).toEqual([
      "workforce_agent.inspect",
      "workforce_agent.hire",
      "workforce_agent.status",
      "workforce_assignment.inspect",
      "workforce_assignment.create",
      "workforce_assignment.claim",
      "workforce_assignment.renew",
      "workforce_assignment.cancel",
      "workforce_assignment.handoff",
      "workforce_assignment.complete",
      "operating_objective.inspect",
      "governed_work.inspect",
      "observed_budget.inspect",
      "operating_board.render",
      "assignment_thread.inspect",
      "assignment_inbox.inspect",
      "governed_attempt.execute",
      "governed_completion.reconcile",
      "assignment_mention.route",
      "assignment_routine.materialize",
      "assignment_connector.route",
    ]);
    expect(output.stderr).toEqual([]);
  });

  it("discovers operating attention additively through protocol version 2", async () => {
    const output = io();

    expect(
      await runApplicationCommand(["capabilities", "--protocol", "2", "--json"], output.value),
    ).toBe(0);
    const report = JSON.parse(output.stdout.join(""));
    expect(report.schemaVersion).toBe(2);
    expect(report.protocol).toEqual({
      transport: "local_cli",
      version: 2,
      discoveryCommand: ["application", "capabilities", "--protocol", "2", "--json"],
      requiresHub: false,
    });
    expect(report.routes.at(-1)).toEqual({
      routeId: "operating_goal.inspect",
      area: "operating",
      operation: "query",
      contractVersion: 1,
      resultContract: "operating_goal_report",
      command: ["loop", "goal", "--json"],
      output: "json",
      effect: "none",
      authority: "read_only",
      availability: "available",
    });
    expect(report.routes.at(-2)).toEqual({
      routeId: "operating_attention.inspect",
      area: "operating",
      operation: "query",
      contractVersion: 1,
      resultContract: "operating_attention_report",
      command: ["application", "attention", "--json"],
      output: "json",
      effect: "none",
      authority: "read_only",
      availability: "available",
    });
    expect(report.projections).toContain("operating_attention");
    expect(report.projections).toContain("operating_goal");
  });

  it("discovers operating liveness additively through protocol version 3", async () => {
    const output = io();

    expect(
      await runApplicationCommand(["capabilities", "--protocol", "3", "--json"], output.value),
    ).toBe(0);
    const report = JSON.parse(output.stdout.join(""));
    expect(report.schemaVersion).toBe(3);
    expect(report.protocol.discoveryCommand).toEqual([
      "application",
      "capabilities",
      "--protocol",
      "3",
      "--json",
    ]);
    expect(report.routes.at(-1)).toEqual({
      routeId: "operating_liveness.inspect",
      area: "operating",
      operation: "query",
      contractVersion: 1,
      resultContract: "operating_liveness_report",
      command: ["application", "liveness", "--json"],
      output: "json",
      effect: "none",
      authority: "read_only",
      availability: "available",
    });
    expect(report.projections).toContain("operating_liveness");
  });

  it("discovers reviewed message triggering and explicit acknowledgement through protocol 4", async () => {
    const output = io();

    expect(
      await runApplicationCommand(["capabilities", "--protocol", "4", "--json"], output.value),
    ).toBe(0);
    const report = JSON.parse(output.stdout.join(""));
    expect(report.schemaVersion).toBe(4);
    expect(
      report.routes.find(
        (route: { routeId: string }) => route.routeId === "assignment_thread.inspect",
      ),
    ).toMatchObject({
      contractVersion: 2,
      resultContract: "assignment_communication_report_v2",
      command: ["loop", "thread", "--contract", "2", "--assignment", "<assignment-id>", "--json"],
    });
    expect(report.routes.slice(-2)).toEqual([
      {
        routeId: "assignment_message_trigger.route",
        area: "collaboration",
        operation: "command",
        contractVersion: 1,
        resultContract: "assignment_message_trigger_result",
        command: ["assignment", "trigger"],
        output: "json",
        effect: "repository_write",
        authority: "exact_plan_apply",
        availability: "available",
      },
      {
        routeId: "assignment_handoff.acknowledge",
        area: "collaboration",
        operation: "command",
        contractVersion: 1,
        resultContract: "assignment_handoff_acknowledgement_result",
        command: ["assignment", "acknowledge"],
        output: "json",
        effect: "repository_write",
        authority: "explicit_write",
        availability: "available",
      },
    ]);
    expect(report.projections).toContain("assignment_acknowledgements");
    expect(report.unsupported).toContain("unattended_scheduling");
  });

  it("discovers bounded unattended execution through protocol 5", async () => {
    const output = io();

    expect(
      await runApplicationCommand(["capabilities", "--protocol", "5", "--json"], output.value),
    ).toBe(0);
    const report = JSON.parse(output.stdout.join(""));
    expect(report.schemaVersion).toBe(5);
    expect(report.routes.at(-1)).toEqual({
      routeId: "unattended_scheduler.execute",
      area: "operating",
      operation: "command",
      contractVersion: 1,
      resultContract: "unattended_scheduler_result",
      command: ["loop", "schedule"],
      output: "json",
      effect: "managed_provider",
      authority: "bounded_unattended_execution",
      availability: "available",
    });
    expect(report.unsupported).not.toContain("unattended_scheduling");
    expect(report.unsupported).toContain("dynamic_graph_mutation");
  });

  it("discovers reviewed bounded topology changes through protocol 6", async () => {
    const output = io();

    expect(
      await runApplicationCommand(["capabilities", "--protocol", "6", "--json"], output.value),
    ).toBe(0);
    const report = JSON.parse(output.stdout.join(""));
    expect(report.schemaVersion).toBe(6);
    expect(report.routes.slice(-2)).toEqual([
      {
        routeId: "assignment_graph.inspect_v2",
        area: "operating",
        operation: "query",
        contractVersion: 2,
        resultContract: "assignment_graph_v2",
        command: ["assignment", "topology", "inspect", "--json"],
        output: "json",
        effect: "none",
        authority: "read_only",
        availability: "available",
      },
      {
        routeId: "assignment_topology.change",
        area: "operating",
        operation: "command",
        contractVersion: 2,
        resultContract: "assignment_topology_result_v2",
        command: ["assignment", "topology", "change"],
        output: "json",
        effect: "repository_write",
        authority: "reviewed_topology_change",
        availability: "available",
      },
    ]);
    expect(report.projections).toContain("assignment_graph_v2");
    expect(report.unsupported).not.toContain("dynamic_graph_mutation");
  });

  it("renders the injected read-only attention report", async () => {
    const output = io();
    const report = {
      schemaVersion: 1 as const,
      kind: "operating_attention.report" as const,
      projectId: "prj_0123456789abcdef",
      workstream: null,
      observedAt: "2026-09-04T00:00:00.000Z",
      reportDigest: `sha256:${"a".repeat(64)}`,
      status: "current" as const,
      coverage: {
        workstream: "missing" as const,
        canonicalization: "complete" as const,
        knowledgeLifecycle: "complete" as const,
      },
      summary: {
        totalCount: 0,
        truncatedCount: 0,
        blockingCount: 0,
        userActionCount: 0,
        staleCount: 0,
      },
      items: [],
      limitations: ["Projection only."],
    };

    expect(
      await runApplicationCommand(["attention", "--json"], output.value, {
        inspectOperatingAttention: async () => report,
        inspectOperatingLiveness: async () => {
          throw new Error("not called");
        },
      }),
    ).toBe(0);
    expect(JSON.parse(output.stdout.join(""))).toEqual(report);
    expect(output.stderr).toEqual([]);
  });

  it("renders the injected read-only liveness report", async () => {
    const output = io();
    const report = {
      schemaVersion: 1 as const,
      kind: "operating_liveness.report" as const,
      projectId: "prj_0123456789abcdef",
      observedAt: "2026-09-05T00:00:00.000Z",
      reportDigest: `sha256:${"a".repeat(64)}`,
      rootAgents: {
        source: "agent.liveness.observed" as const,
        staleAfterMs: 1_000,
        items: [],
      },
      managedProviderProcesses: {
        source: "provider.process.observed" as const,
        semantics: "latest_point_in_time_observation_per_provider_session" as const,
        maximumItems: 256,
        totalCount: 0,
        truncatedCount: 0,
        items: [],
      },
      summary: {
        rootAgentCount: 0,
        rootAgentStatusCounts: {
          inactive: 0,
          unobserved: 0,
          agent_revision_changed: 0,
          recently_observed: 0,
          stale_observation: 0,
        },
        managedProviderSessionCount: 0,
        managedProviderStatusCounts: { running: 0, exited: 0, unobservable: 0 },
      },
      authority: {
        releasesAgentAuthority: false as const,
        releasesAssignmentAuthority: false as const,
        startsOrStopsProvider: false as const,
        provesWorkProgress: false as const,
      },
      limitations: ["Projection only."],
    };

    expect(
      await runApplicationCommand(
        ["liveness", "--stale-after-ms", "1000", "--json"],
        output.value,
        {
          inspectOperatingAttention: async () => {
            throw new Error("not called");
          },
          inspectOperatingLiveness: async (input) => {
            expect(input.staleAfterMs).toBe(1_000);
            return report;
          },
        },
      ),
    ).toBe(0);
    expect(JSON.parse(output.stdout.join(""))).toEqual(report);
    expect(output.stderr).toEqual([]);
  });

  it("keeps external delivery adapter-required and product authority unsupported", () => {
    const report = createProductHostCapabilityReport();
    const connector = report.routes.find((route) => route.routeId === "assignment_connector.route");

    expect(connector).toMatchObject({
      effect: "external_delivery",
      authority: "injected_adapter",
      availability: "adapter_required_for_effect",
    });
    expect(report.unsupported).toContain("product_database");
    expect(report.unsupported).toContain("implicit_approval");
    expect(report.unsupported).toContain("unattended_scheduling");
  });

  it("renders a human-readable route inventory", async () => {
    const output = io();

    expect(await runApplicationCommand(["capabilities"], output.value)).toBe(0);
    expect(output.stdout.join("")).toContain("Lervo product-host protocol v1");
    expect(output.stdout.join("")).toContain("governed_work.inspect");
    expect(output.stdout.join("")).toContain("workforce_assignment.create");
    expect(output.stdout.join("")).toContain("product_database");
    expect(output.stderr).toEqual([]);
  });

  it("rejects unknown application actions", async () => {
    const output = io();

    expect(await runApplicationCommand(["unknown"], output.value)).toBe(1);
    expect(output.stdout).toEqual([]);
    expect(output.stderr.join("")).toContain("The application action is invalid.");
    expect(output.stderr.join("")).toContain("lervo application capabilities");
  });
});
