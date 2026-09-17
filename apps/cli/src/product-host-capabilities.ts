import type {
  ProductHostCapabilityReport,
  ProductHostCapabilityReportV1,
  ProductHostCapabilityReportV2,
  ProductHostCapabilityReportV3,
  ProductHostCapabilityReportV4,
  ProductHostCapabilityReportV7,
  ProductHostCapabilityReportV8,
  ProductHostCapabilityReportV9,
  ProductHostCapabilityReportV10,
} from "@lervo/application-contract";

import { upgradeProductHostCapabilityReportV4 } from "./product-host-capabilities-v4.js";
import { upgradeProductHostCapabilityReportV5 } from "./product-host-capabilities-v5.js";
import { upgradeProductHostCapabilityReportV6 } from "./product-host-capabilities-v6.js";
import { upgradeProductHostCapabilityReportV7 } from "./product-host-capabilities-v7.js";
import { upgradeProductHostCapabilityReportV8 } from "./product-host-capabilities-v8.js";
import { upgradeProductHostCapabilityReportV9 } from "./product-host-capabilities-v9.js";
import { upgradeProductHostCapabilityReportV10 } from "./product-host-capabilities-v10.js";
import { upgradeProductHostCapabilityReportV11 } from "./product-host-capabilities-v11.js";

function createProductHostCapabilityReportV1(): ProductHostCapabilityReportV1 {
  return {
    schemaVersion: 1,
    kind: "product_host.capabilities",
    protocol: {
      transport: "local_cli",
      version: 1,
      discoveryCommand: ["application", "capabilities", "--json"],
      requiresHub: false,
    },
    canonicalAuthorities: [
      "repository_state",
      "workstreams",
      "assignments",
      "leases",
      "events",
      "verification",
      "artifacts",
    ],
    projections: [
      "assignment_graph",
      "governed_decision",
      "operating_board",
      "assignment_threads",
      "assignment_inboxes",
      "observed_budgets",
    ],
    routes: [
      {
        routeId: "workforce_agent.inspect",
        area: "workforce",
        operation: "query",
        contractVersion: 1,
        resultContract: "workforce_agent_list",
        command: ["agent", "list", "--json"],
        output: "json",
        effect: "none",
        authority: "read_only",
        availability: "available",
      },
      {
        routeId: "workforce_agent.hire",
        area: "workforce",
        operation: "command",
        contractVersion: 1,
        resultContract: "workforce_agent",
        command: ["agent", "hire"],
        output: "json",
        effect: "repository_write",
        authority: "explicit_write",
        availability: "available",
      },
      {
        routeId: "workforce_agent.status",
        area: "workforce",
        operation: "command",
        contractVersion: 1,
        resultContract: "workforce_agent",
        command: ["agent", "status"],
        output: "json",
        effect: "repository_write",
        authority: "explicit_write",
        availability: "available",
      },
      {
        routeId: "workforce_assignment.inspect",
        area: "workforce",
        operation: "query",
        contractVersion: 1,
        resultContract: "workforce_assignment_list",
        command: ["assignment", "list", "--json"],
        output: "json",
        effect: "none",
        authority: "read_only",
        availability: "available",
      },
      {
        routeId: "workforce_assignment.create",
        area: "workforce",
        operation: "command",
        contractVersion: 1,
        resultContract: "workforce_assignment",
        command: ["assignment", "create"],
        output: "json",
        effect: "repository_write",
        authority: "explicit_write",
        availability: "available",
      },
      {
        routeId: "workforce_assignment.claim",
        area: "workforce",
        operation: "command",
        contractVersion: 1,
        resultContract: "workforce_assignment",
        command: ["assignment", "claim"],
        output: "json",
        effect: "repository_write",
        authority: "explicit_write",
        availability: "available",
      },
      {
        routeId: "workforce_assignment.renew",
        area: "workforce",
        operation: "command",
        contractVersion: 1,
        resultContract: "workforce_assignment",
        command: ["assignment", "renew"],
        output: "json",
        effect: "repository_write",
        authority: "explicit_write",
        availability: "available",
      },
      {
        routeId: "workforce_assignment.cancel",
        area: "workforce",
        operation: "command",
        contractVersion: 1,
        resultContract: "assignment_cancellation_result",
        command: ["assignment", "cancel"],
        output: "json",
        effect: "repository_write",
        authority: "exact_plan_apply",
        availability: "available",
      },
      {
        routeId: "workforce_assignment.handoff",
        area: "workforce",
        operation: "command",
        contractVersion: 1,
        resultContract: "workforce_assignment",
        command: ["assignment", "handoff"],
        output: "json",
        effect: "repository_write",
        authority: "explicit_write",
        availability: "available",
      },
      {
        routeId: "workforce_assignment.complete",
        area: "workforce",
        operation: "command",
        contractVersion: 1,
        resultContract: "workforce_assignment",
        command: ["assignment", "complete"],
        output: "json",
        effect: "repository_write",
        authority: "explicit_write",
        availability: "available",
      },
      {
        routeId: "operating_objective.inspect",
        area: "operating",
        operation: "query",
        contractVersion: 1,
        resultContract: "operating_objective_report",
        command: ["loop", "objective", "--json"],
        output: "json",
        effect: "none",
        authority: "read_only",
        availability: "available",
      },
      {
        routeId: "governed_work.inspect",
        area: "operating",
        operation: "query",
        contractVersion: 1,
        resultContract: "governed_work_report",
        command: ["loop", "status", "--json"],
        output: "json",
        effect: "none",
        authority: "read_only",
        availability: "available",
      },
      {
        routeId: "observed_budget.inspect",
        area: "operating",
        operation: "query",
        contractVersion: 1,
        resultContract: "operating_budget_group_list",
        command: ["loop", "budget", "--json"],
        output: "json",
        effect: "none",
        authority: "read_only",
        availability: "available",
      },
      {
        routeId: "operating_board.render",
        area: "operating",
        operation: "presentation",
        contractVersion: 1,
        resultContract: "operating_board_html",
        command: ["loop", "board"],
        output: "html",
        effect: "none",
        authority: "read_only",
        availability: "available",
      },
      {
        routeId: "assignment_thread.inspect",
        area: "collaboration",
        operation: "query",
        contractVersion: 1,
        resultContract: "assignment_communication_report",
        command: ["loop", "thread", "--assignment", "<assignment-id>", "--json"],
        output: "json",
        effect: "none",
        authority: "read_only",
        availability: "available",
      },
      {
        routeId: "assignment_inbox.inspect",
        area: "collaboration",
        operation: "query",
        contractVersion: 1,
        resultContract: "assignment_communication_report",
        command: ["loop", "inbox", "--agent", "<agent-id>", "--json"],
        output: "json",
        effect: "none",
        authority: "read_only",
        availability: "available",
      },
      {
        routeId: "governed_attempt.execute",
        area: "operating",
        operation: "command",
        contractVersion: 1,
        resultContract: "governed_attempt_result",
        command: ["loop", "run"],
        output: "json",
        effect: "managed_provider",
        authority: "lease_bound_managed_execution",
        availability: "available",
      },
      {
        routeId: "governed_completion.reconcile",
        area: "operating",
        operation: "command",
        contractVersion: 1,
        resultContract: "governed_completion_reconciliation_result",
        command: ["loop", "reconcile"],
        output: "json",
        effect: "repository_write",
        authority: "exact_plan_apply",
        availability: "available",
      },
      {
        routeId: "assignment_mention.route",
        area: "collaboration",
        operation: "command",
        contractVersion: 1,
        resultContract: "assignment_mention_route_result",
        command: ["assignment", "mention"],
        output: "json",
        effect: "repository_write",
        authority: "exact_plan_apply",
        availability: "available",
      },
      {
        routeId: "assignment_routine.materialize",
        area: "operating",
        operation: "command",
        contractVersion: 1,
        resultContract: "assignment_routine_result",
        command: ["routine", "materialize"],
        output: "json",
        effect: "repository_write",
        authority: "exact_plan_apply",
        availability: "available",
      },
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
    ],
    unsupported: [
      "product_ui",
      "product_database",
      "unattended_scheduling",
      "dynamic_graph_mutation",
      "implicit_approval",
      "unmanaged_terminal_execution",
    ],
  };
}

function createProductHostCapabilityReportV2(): ProductHostCapabilityReportV2 {
  const versionOne = createProductHostCapabilityReportV1();
  return {
    schemaVersion: 2,
    kind: "product_host.capabilities",
    protocol: {
      transport: "local_cli",
      version: 2,
      discoveryCommand: ["application", "capabilities", "--protocol", "2", "--json"],
      requiresHub: false,
    },
    canonicalAuthorities: versionOne.canonicalAuthorities,
    projections: [...versionOne.projections, "operating_attention", "operating_goal"],
    routes: [
      ...versionOne.routes,
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
    ],
    unsupported: versionOne.unsupported,
  };
}

function createProductHostCapabilityReportV3(): ProductHostCapabilityReportV3 {
  const versionTwo = createProductHostCapabilityReportV2();
  return {
    schemaVersion: 3,
    kind: "product_host.capabilities",
    protocol: {
      transport: "local_cli",
      version: 3,
      discoveryCommand: ["application", "capabilities", "--protocol", "3", "--json"],
      requiresHub: false,
    },
    canonicalAuthorities: versionTwo.canonicalAuthorities,
    projections: [...versionTwo.projections, "operating_liveness"],
    routes: [
      ...versionTwo.routes,
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
    ],
    unsupported: versionTwo.unsupported,
  };
}

export function createProductHostCapabilityReport(
  protocolVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 = 1,
): ProductHostCapabilityReport {
  if (protocolVersion === 1) return createProductHostCapabilityReportV1();
  if (protocolVersion === 2) return createProductHostCapabilityReportV2();
  if (protocolVersion === 3) return createProductHostCapabilityReportV3();
  const versionFour: ProductHostCapabilityReportV4 = upgradeProductHostCapabilityReportV4(
    createProductHostCapabilityReportV3(),
  );
  if (protocolVersion === 4) return versionFour;
  const versionFive = upgradeProductHostCapabilityReportV5(versionFour);
  if (protocolVersion === 5) return versionFive;
  const versionSix = upgradeProductHostCapabilityReportV6(versionFive);
  if (protocolVersion === 6) return versionSix;
  const versionSeven: ProductHostCapabilityReportV7 =
    upgradeProductHostCapabilityReportV7(versionSix);
  if (protocolVersion === 7) return versionSeven;
  const versionEight: ProductHostCapabilityReportV8 =
    upgradeProductHostCapabilityReportV8(versionSeven);
  if (protocolVersion === 8) return versionEight;
  const versionNine: ProductHostCapabilityReportV9 =
    upgradeProductHostCapabilityReportV9(versionEight);
  if (protocolVersion === 9) return versionNine;
  const versionTen: ProductHostCapabilityReportV10 =
    upgradeProductHostCapabilityReportV10(versionNine);
  return protocolVersion === 10 ? versionTen : upgradeProductHostCapabilityReportV11(versionTen);
}
