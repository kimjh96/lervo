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
  effect: "none" | "repository_write" | "managed_provider" | "external_delivery";
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
