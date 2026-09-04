import assert from "node:assert/strict";

const versionOneRouteIds = [
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
];

const versionTwoRouteIds = [
  ...versionOneRouteIds,
  "operating_attention.inspect",
  "operating_goal.inspect",
];

function parsed(result) {
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

export async function verifyPackedProductHostCapabilities(runCli) {
  const capabilities = parsed(await runCli(["application", "capabilities", "--json"]));
  assert.equal(capabilities.schemaVersion, 1);
  assert.equal(capabilities.kind, "product_host.capabilities");
  assert.deepEqual(capabilities.protocol, {
    transport: "local_cli",
    version: 1,
    discoveryCommand: ["application", "capabilities", "--json"],
    requiresHub: false,
  });
  assert.deepEqual(
    capabilities.routes.map((route) => route.routeId),
    versionOneRouteIds,
  );
  assert.equal(
    capabilities.routes
      .filter((route) => route.effect === "none")
      .every((route) => route.authority === "read_only"),
    true,
  );
  assert.deepEqual(
    capabilities.routes.find((route) => route.routeId === "assignment_connector.route"),
    {
      routeId: "assignment_connector.route",
      area: "collaboration",
      operation: "command",
      contractVersion: 1,
      resultContract: "assignment_connector_route_result",
      command: ["assignment", "connector"],
      output: "json",
      effect: "external_delivery",
      authority: "injected_adapter",
      availability: "adapter_required_for_effect",
    },
  );
  assert.deepEqual(capabilities.unsupported, [
    "product_ui",
    "product_database",
    "unattended_scheduling",
    "dynamic_graph_mutation",
    "implicit_approval",
    "unmanaged_terminal_execution",
  ]);
  assert.equal(JSON.stringify(capabilities).includes("workspace:"), false);
  assert.equal(JSON.stringify(capabilities).includes("@lervo/"), false);

  const versionTwo = parsed(
    await runCli(["application", "capabilities", "--protocol", "2", "--json"]),
  );
  assert.equal(versionTwo.schemaVersion, 2);
  assert.deepEqual(versionTwo.protocol, {
    transport: "local_cli",
    version: 2,
    discoveryCommand: ["application", "capabilities", "--protocol", "2", "--json"],
    requiresHub: false,
  });
  assert.deepEqual(
    versionTwo.routes.map((route) => route.routeId),
    versionTwoRouteIds,
  );
  assert.deepEqual(
    versionTwo.routes.find((route) => route.routeId === "operating_attention.inspect"),
    {
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
    },
  );
  assert.deepEqual(
    versionTwo.routes.find((route) => route.routeId === "operating_goal.inspect"),
    {
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
    },
  );
  assert.equal(versionTwo.projections.includes("operating_attention"), true);
  assert.equal(versionTwo.projections.includes("operating_goal"), true);
  return versionTwo;
}
