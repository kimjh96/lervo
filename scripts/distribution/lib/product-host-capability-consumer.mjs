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

const versionThreeRouteIds = [...versionTwoRouteIds, "operating_liveness.inspect"];

const versionFourRouteIds = [
  ...versionThreeRouteIds,
  "assignment_message_trigger.route",
  "assignment_handoff.acknowledge",
];

const versionFiveRouteIds = [...versionFourRouteIds, "unattended_scheduler.execute"];

const versionSixRouteIds = [
  ...versionFiveRouteIds,
  "assignment_graph.inspect_v2",
  "assignment_topology.change",
];

const versionSevenRouteIds = [
  ...versionSixRouteIds,
  "workforce_agent.rename",
  "organization_team.bind",
  "organization_team.reclassify",
  "organization_portfolio.inspect",
  "agent_context.inspect",
  "agent_context.promote",
  "agent_context.handoff",
  "organization_ceo.evaluate",
  "organization_executive.execute",
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
  const versionThree = parsed(
    await runCli(["application", "capabilities", "--protocol", "3", "--json"]),
  );
  assert.equal(versionThree.schemaVersion, 3);
  assert.deepEqual(versionThree.protocol, {
    transport: "local_cli",
    version: 3,
    discoveryCommand: ["application", "capabilities", "--protocol", "3", "--json"],
    requiresHub: false,
  });
  assert.deepEqual(
    versionThree.routes.map((route) => route.routeId),
    versionThreeRouteIds,
  );
  assert.deepEqual(
    versionThree.routes.find((route) => route.routeId === "operating_liveness.inspect"),
    {
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
    },
  );
  assert.equal(versionThree.projections.includes("operating_liveness"), true);
  const versionFour = parsed(
    await runCli(["application", "capabilities", "--protocol", "4", "--json"]),
  );
  assert.equal(versionFour.schemaVersion, 4);
  assert.deepEqual(versionFour.protocol, {
    transport: "local_cli",
    version: 4,
    discoveryCommand: ["application", "capabilities", "--protocol", "4", "--json"],
    requiresHub: false,
  });
  assert.deepEqual(
    versionFour.routes.map((route) => route.routeId),
    versionFourRouteIds,
  );
  assert.deepEqual(
    versionFour.routes.find((route) => route.routeId === "assignment_thread.inspect"),
    {
      routeId: "assignment_thread.inspect",
      area: "collaboration",
      operation: "query",
      contractVersion: 2,
      resultContract: "assignment_communication_report_v2",
      command: ["loop", "thread", "--contract", "2", "--assignment", "<assignment-id>", "--json"],
      output: "json",
      effect: "none",
      authority: "read_only",
      availability: "available",
    },
  );
  assert.deepEqual(versionFour.routes.slice(-2), [
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
  assert.equal(versionFour.projections.includes("assignment_acknowledgements"), true);
  const versionFive = parsed(
    await runCli(["application", "capabilities", "--protocol", "5", "--json"]),
  );
  assert.equal(versionFive.schemaVersion, 5);
  assert.deepEqual(versionFive.protocol, {
    transport: "local_cli",
    version: 5,
    discoveryCommand: ["application", "capabilities", "--protocol", "5", "--json"],
    requiresHub: false,
  });
  assert.deepEqual(
    versionFive.routes.map((route) => route.routeId),
    versionFiveRouteIds,
  );
  assert.deepEqual(versionFive.routes.at(-1), {
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
  assert.equal(versionFive.unsupported.includes("unattended_scheduling"), false);
  const versionSix = parsed(
    await runCli(["application", "capabilities", "--protocol", "6", "--json"]),
  );
  assert.equal(versionSix.schemaVersion, 6);
  assert.deepEqual(versionSix.protocol, {
    transport: "local_cli",
    version: 6,
    discoveryCommand: ["application", "capabilities", "--protocol", "6", "--json"],
    requiresHub: false,
  });
  assert.deepEqual(
    versionSix.routes.map((route) => route.routeId),
    versionSixRouteIds,
  );
  assert.deepEqual(versionSix.routes.slice(-2), [
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
  assert.equal(versionSix.projections.includes("assignment_graph_v2"), true);
  assert.equal(versionSix.unsupported.includes("dynamic_graph_mutation"), false);
  const versionSeven = parsed(
    await runCli(["application", "capabilities", "--protocol", "7", "--json"]),
  );
  assert.equal(versionSeven.schemaVersion, 7);
  assert.deepEqual(versionSeven.protocol, {
    transport: "local_cli",
    version: 7,
    discoveryCommand: ["application", "capabilities", "--protocol", "7", "--json"],
    requiresHub: false,
  });
  assert.deepEqual(
    versionSeven.routes.map((route) => route.routeId),
    versionSevenRouteIds,
  );
  assert.deepEqual(
    versionSeven.routes.filter((route) =>
      [
        "workforce_agent.rename",
        "organization_team.reclassify",
        "organization_executive.execute",
      ].includes(route.routeId),
    ),
    [
      {
        routeId: "workforce_agent.rename",
        area: "workforce",
        operation: "command",
        contractVersion: 1,
        resultContract: "workforce_agent",
        command: ["agent", "rename", "--write"],
        output: "json",
        effect: "repository_write",
        authority: "explicit_write",
        availability: "available",
      },
      {
        routeId: "organization_team.reclassify",
        area: "organization",
        operation: "command",
        contractVersion: 1,
        resultContract: "agent_organization_projection",
        command: ["organization", "set-team-kind", "--write"],
        output: "json",
        effect: "repository_write",
        authority: "explicit_write",
        availability: "available",
      },
      {
        routeId: "organization_executive.execute",
        area: "organization",
        operation: "command",
        contractVersion: 1,
        resultContract: "organization_executive_execution_result",
        command: ["organization", "executive-execute", "--write", "--json"],
        output: "json",
        effect: "installed_effect",
        authority: "bounded_organization_executive_effect",
        availability: "available",
      },
    ],
  );
  assert.deepEqual(
    versionSeven.routes.slice(-6).map((route) => route.area),
    [
      "organization",
      "organization",
      "organization",
      "organization",
      "organization",
      "organization",
    ],
  );
  assert.equal(versionSeven.projections.includes("agent_context"), true);
  assert.equal(versionSeven.projections.includes("organization_operating_report"), true);
  return versionSeven;
}
