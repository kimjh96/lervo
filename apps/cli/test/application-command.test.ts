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
