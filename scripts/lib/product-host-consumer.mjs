import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const routeIds = [
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

function parsed(result) {
  assert.equal(result.stderr, "");
  return JSON.parse(result.stdout);
}

export async function verifyPackedProductHostConsumer(consumerRoot, runCli) {
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
    routeIds,
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

  const initialAgents = parsed(await runCli(["agent", "list", "--json"]));
  assert.equal(initialAgents.schemaVersion, 1);
  assert.deepEqual(initialAgents.agents, []);
  const agent = parsed(
    await runCli([
      "agent",
      "hire",
      "--role",
      "developer",
      "--provider",
      "any",
      "--scope",
      "product-host-fixture.txt",
      "--write",
      "--json",
    ]),
  );
  assert.equal(agent.status, "active");
  const agentId = agent.agentId;

  const draft = {
    schemaVersion: 1,
    status: "active",
    title: "Packed product-host acceptance",
    objective: "Prove operating and collaboration routes through the installed CLI only.",
    nextActions: ["Inspect the external product-host projection."],
    blockers: [],
    notes: ["The fixture grants no provider, Hub, or connector authority."],
    references: [],
    pendingDecisions: [],
    pendingApprovals: [],
    updatedAt: "2026-09-03T00:00:00.000Z",
  };
  const draftPath = resolve(consumerRoot, "product-host-workstream.json");
  await writeFile(draftPath, `${JSON.stringify(draft)}\n`, "utf8");
  const startPlan = parsed(await runCli(["workstream", "start", "--from", draftPath, "--json"]));
  assert.equal(startPlan.status, "ready");
  const workstream = parsed(
    await runCli([
      "workstream",
      "start",
      "--from",
      draftPath,
      "--apply",
      startPlan.planId,
      "--json",
    ]),
  );
  assert.equal(workstream.status, "active");

  const assignment = parsed(
    await runCli([
      "assignment",
      "create",
      "--type",
      "product_host_acceptance",
      "--role",
      "developer",
      "--criteria",
      "Expose the canonical assignment through the product-host projection.",
      "--suite",
      "project.quick",
      "--path",
      "product-host-fixture.txt",
      "--workstream",
      workstream.workstreamId,
      "--write",
      "--json",
    ]),
  );
  assert.equal(assignment.status, "queued");
  const assignments = parsed(await runCli(["assignment", "list", "--json"]));
  assert.deepEqual(
    assignments.assignments.map((item) => item.assignmentId),
    [assignment.assignmentId],
  );

  const objective = parsed(await runCli(["loop", "objective", "--json"]));
  assert.equal(objective.workstreamId, workstream.workstreamId);
  assert.equal(objective.objective, draft.objective);

  const governedWork = parsed(await runCli(["loop", "status", "--json"]));
  assert.equal(governedWork.workstreamId, workstream.workstreamId);
  assert.deepEqual(
    governedWork.graph.nodes.map((node) => node.assignmentId),
    [assignment.assignmentId],
  );
  assert.equal(governedWork.decision.status, "ready");
  assert.equal(governedWork.decision.actions[0].kind, "claim_assignment");

  const budgets = parsed(await runCli(["loop", "budget", "--json"]));
  assert.deepEqual(budgets, []);

  const thread = parsed(
    await runCli(["loop", "thread", "--assignment", assignment.assignmentId, "--json"]),
  );
  assert.equal(thread.validity.status, "valid");
  assert.equal(thread.threads[0].assignmentId, assignment.assignmentId);
  assert.deepEqual(thread.threads[0].routes, []);

  const inbox = parsed(await runCli(["loop", "inbox", "--agent", agentId, "--json"]));
  assert.equal(inbox.validity.status, "valid");
  assert.deepEqual(inbox.inbox, []);

  const board = await runCli(["loop", "board"]);
  assert.equal(board.stderr, "");
  assert.match(board.stdout, /^<!doctype html>/u);
  assert.equal(board.stdout.includes("Projection, not authority"), true);
  assert.equal(board.stdout.includes(assignment.assignmentId), true);

  return {
    protocolVersion: capabilities.protocol.version,
    routeCount: capabilities.routes.length,
    workforceRouteCount: capabilities.routes.filter((route) => route.area === "workforce").length,
    operatingRouteCount: capabilities.routes.filter((route) => route.area === "operating").length,
    collaborationRouteCount: capabilities.routes.filter((route) => route.area === "collaboration")
      .length,
  };
}
