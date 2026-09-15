export type ProductHostRouteIdV1 =
  | "workforce_agent.inspect"
  | "workforce_agent.hire"
  | "workforce_agent.status"
  | "workforce_assignment.inspect"
  | "workforce_assignment.create"
  | "workforce_assignment.claim"
  | "workforce_assignment.renew"
  | "workforce_assignment.cancel"
  | "workforce_assignment.handoff"
  | "workforce_assignment.complete"
  | "operating_objective.inspect"
  | "governed_work.inspect"
  | "observed_budget.inspect"
  | "operating_board.render"
  | "assignment_thread.inspect"
  | "assignment_inbox.inspect"
  | "governed_attempt.execute"
  | "governed_completion.reconcile"
  | "assignment_mention.route"
  | "assignment_routine.materialize"
  | "assignment_connector.route";

export type ProductHostResultContractV1 =
  | "workforce_agent_list"
  | "workforce_agent"
  | "workforce_assignment_list"
  | "workforce_assignment"
  | "assignment_cancellation_result"
  | "operating_objective_report"
  | "governed_work_report"
  | "operating_budget_group_list"
  | "operating_board_html"
  | "assignment_communication_report"
  | "governed_attempt_result"
  | "governed_completion_reconciliation_result"
  | "assignment_mention_route_result"
  | "assignment_routine_result"
  | "assignment_connector_route_result";

export interface ProductHostRouteV1 {
  routeId: ProductHostRouteIdV1;
  area: "workforce" | "operating" | "collaboration";
  operation: "query" | "presentation" | "command";
  contractVersion: 1;
  resultContract: ProductHostResultContractV1;
  command: string[];
  output: "json" | "html";
  effect:
    "none" | "repository_write" | "managed_provider" | "external_delivery" | "installed_effect";
  authority:
    | "read_only"
    | "explicit_write"
    | "exact_plan_apply"
    | "lease_bound_managed_execution"
    | "injected_adapter";
  availability: "available" | "adapter_required_for_effect";
}

export interface ProductHostCapabilityReportV1 {
  schemaVersion: 1;
  kind: "product_host.capabilities";
  protocol: {
    transport: "local_cli";
    version: 1;
    discoveryCommand: ["application", "capabilities", "--json"];
    requiresHub: false;
  };
  canonicalAuthorities: [
    "repository_state",
    "workstreams",
    "assignments",
    "leases",
    "events",
    "verification",
    "artifacts",
  ];
  projections: [
    "assignment_graph",
    "governed_decision",
    "operating_board",
    "assignment_threads",
    "assignment_inboxes",
    "observed_budgets",
  ];
  routes: ProductHostRouteV1[];
  unsupported: [
    "product_ui",
    "product_database",
    "unattended_scheduling",
    "dynamic_graph_mutation",
    "implicit_approval",
    "unmanaged_terminal_execution",
  ];
}

export type ProductHostRouteIdV2 =
  ProductHostRouteIdV1 | "operating_attention.inspect" | "operating_goal.inspect";

export type ProductHostResultContractV2 =
  ProductHostResultContractV1 | "operating_attention_report" | "operating_goal_report";

export interface ProductHostRouteV2 extends Omit<ProductHostRouteV1, "routeId" | "resultContract"> {
  routeId: ProductHostRouteIdV2;
  resultContract: ProductHostResultContractV2;
}

export interface ProductHostCapabilityReportV2 {
  schemaVersion: 2;
  kind: "product_host.capabilities";
  protocol: {
    transport: "local_cli";
    version: 2;
    discoveryCommand: ["application", "capabilities", "--protocol", "2", "--json"];
    requiresHub: false;
  };
  canonicalAuthorities: ProductHostCapabilityReportV1["canonicalAuthorities"];
  projections: [
    "assignment_graph",
    "governed_decision",
    "operating_board",
    "assignment_threads",
    "assignment_inboxes",
    "observed_budgets",
    "operating_attention",
    "operating_goal",
  ];
  routes: ProductHostRouteV2[];
  unsupported: ProductHostCapabilityReportV1["unsupported"];
}

export type ProductHostRouteIdV3 = ProductHostRouteIdV2 | "operating_liveness.inspect";

export type ProductHostResultContractV3 = ProductHostResultContractV2 | "operating_liveness_report";

export interface ProductHostRouteV3 extends Omit<ProductHostRouteV1, "routeId" | "resultContract"> {
  routeId: ProductHostRouteIdV3;
  resultContract: ProductHostResultContractV3;
}

export interface ProductHostCapabilityReportV3 {
  schemaVersion: 3;
  kind: "product_host.capabilities";
  protocol: {
    transport: "local_cli";
    version: 3;
    discoveryCommand: ["application", "capabilities", "--protocol", "3", "--json"];
    requiresHub: false;
  };
  canonicalAuthorities: ProductHostCapabilityReportV1["canonicalAuthorities"];
  projections: [
    "assignment_graph",
    "governed_decision",
    "operating_board",
    "assignment_threads",
    "assignment_inboxes",
    "observed_budgets",
    "operating_attention",
    "operating_goal",
    "operating_liveness",
  ];
  routes: ProductHostRouteV3[];
  unsupported: ProductHostCapabilityReportV1["unsupported"];
}

export type ProductHostRouteIdV4 =
  ProductHostRouteIdV3 | "assignment_message_trigger.route" | "assignment_handoff.acknowledge";

export type ProductHostResultContractV4 =
  | ProductHostResultContractV3
  | "assignment_communication_report_v2"
  | "assignment_message_trigger_result"
  | "assignment_handoff_acknowledgement_result";

export interface ProductHostRouteV4 extends Omit<
  ProductHostRouteV1,
  "routeId" | "resultContract" | "contractVersion"
> {
  routeId: ProductHostRouteIdV4;
  contractVersion: 1 | 2;
  resultContract: ProductHostResultContractV4;
}

export interface ProductHostCapabilityReportV4 {
  schemaVersion: 4;
  kind: "product_host.capabilities";
  protocol: {
    transport: "local_cli";
    version: 4;
    discoveryCommand: ["application", "capabilities", "--protocol", "4", "--json"];
    requiresHub: false;
  };
  canonicalAuthorities: ProductHostCapabilityReportV1["canonicalAuthorities"];
  projections: [
    "assignment_graph",
    "governed_decision",
    "operating_board",
    "assignment_threads",
    "assignment_inboxes",
    "observed_budgets",
    "operating_attention",
    "operating_goal",
    "operating_liveness",
    "assignment_acknowledgements",
  ];
  routes: ProductHostRouteV4[];
  unsupported: ProductHostCapabilityReportV1["unsupported"];
}

export type ProductHostRouteIdV5 = ProductHostRouteIdV4 | "unattended_scheduler.execute";

export type ProductHostResultContractV5 =
  ProductHostResultContractV4 | "unattended_scheduler_result";

export interface ProductHostRouteV5 extends Omit<
  ProductHostRouteV1,
  "routeId" | "resultContract" | "contractVersion" | "authority"
> {
  routeId: ProductHostRouteIdV5;
  contractVersion: 1 | 2;
  resultContract: ProductHostResultContractV5;
  authority: ProductHostRouteV1["authority"] | "bounded_unattended_execution";
}

export interface ProductHostCapabilityReportV5 {
  schemaVersion: 5;
  kind: "product_host.capabilities";
  protocol: {
    transport: "local_cli";
    version: 5;
    discoveryCommand: ["application", "capabilities", "--protocol", "5", "--json"];
    requiresHub: false;
  };
  canonicalAuthorities: ProductHostCapabilityReportV1["canonicalAuthorities"];
  projections: ProductHostCapabilityReportV4["projections"];
  routes: ProductHostRouteV5[];
  unsupported: [
    "product_ui",
    "product_database",
    "dynamic_graph_mutation",
    "implicit_approval",
    "unmanaged_terminal_execution",
  ];
}

export type ProductHostRouteIdV6 =
  ProductHostRouteIdV5 | "assignment_graph.inspect_v2" | "assignment_topology.change";

export type ProductHostResultContractV6 =
  ProductHostResultContractV5 | "assignment_graph_v2" | "assignment_topology_result_v2";

export interface ProductHostRouteV6 extends Omit<
  ProductHostRouteV1,
  "routeId" | "resultContract" | "contractVersion" | "authority"
> {
  routeId: ProductHostRouteIdV6;
  contractVersion: 1 | 2;
  resultContract: ProductHostResultContractV6;
  authority:
    ProductHostRouteV1["authority"] | "bounded_unattended_execution" | "reviewed_topology_change";
}

export interface ProductHostCapabilityReportV6 {
  schemaVersion: 6;
  kind: "product_host.capabilities";
  protocol: {
    transport: "local_cli";
    version: 6;
    discoveryCommand: ["application", "capabilities", "--protocol", "6", "--json"];
    requiresHub: false;
  };
  canonicalAuthorities: ProductHostCapabilityReportV1["canonicalAuthorities"];
  projections: [...ProductHostCapabilityReportV4["projections"], "assignment_graph_v2"];
  routes: ProductHostRouteV6[];
  unsupported: [
    "product_ui",
    "product_database",
    "implicit_approval",
    "unmanaged_terminal_execution",
  ];
}

export type ProductHostRouteIdV7 =
  | ProductHostRouteIdV6
  | "workforce_agent.rename"
  | "organization_team.bind"
  | "organization_team.reclassify"
  | "organization_portfolio.inspect"
  | "agent_context.inspect"
  | "agent_context.promote"
  | "agent_context.handoff"
  | "organization_ceo.evaluate"
  | "organization_executive.execute";

export type ProductHostResultContractV7 =
  | ProductHostResultContractV6
  | "agent_organization_projection"
  | "organization_operating_report"
  | "agent_context_projection"
  | "ceo_command_decision"
  | "organization_executive_execution_result";

export interface ProductHostRouteV7 extends Omit<
  ProductHostRouteV1,
  "routeId" | "resultContract" | "contractVersion" | "authority" | "area"
> {
  routeId: ProductHostRouteIdV7;
  area: ProductHostRouteV1["area"] | "organization";
  contractVersion: 1 | 2;
  resultContract: ProductHostResultContractV7;
  authority:
    | ProductHostRouteV6["authority"]
    | "reviewed_context_promotion"
    | "bounded_ceo_policy"
    | "bounded_organization_executive_effect";
}

export interface ProductHostCapabilityReportV7 {
  schemaVersion: 7;
  kind: "product_host.capabilities";
  protocol: {
    transport: "local_cli";
    version: 7;
    discoveryCommand: ["application", "capabilities", "--protocol", "7", "--json"];
    requiresHub: false;
  };
  canonicalAuthorities: ProductHostCapabilityReportV1["canonicalAuthorities"];
  projections: [
    ...ProductHostCapabilityReportV6["projections"],
    "agent_context",
    "organization_operating_report",
  ];
  routes: ProductHostRouteV7[];
  unsupported: ProductHostCapabilityReportV6["unsupported"];
}

export type ProductHostCapabilityReport =
  | ProductHostCapabilityReportV1
  | ProductHostCapabilityReportV2
  | ProductHostCapabilityReportV3
  | ProductHostCapabilityReportV4
  | ProductHostCapabilityReportV5
  | ProductHostCapabilityReportV6
  | ProductHostCapabilityReportV7;
