import type {
  ProductHostCapabilityReportV3,
  ProductHostCapabilityReportV4,
} from "@lervo/application-contract";

export function upgradeProductHostCapabilityReportV4(
  versionThree: ProductHostCapabilityReportV3,
): ProductHostCapabilityReportV4 {
  return {
    schemaVersion: 4,
    kind: "product_host.capabilities",
    protocol: {
      transport: "local_cli",
      version: 4,
      discoveryCommand: ["application", "capabilities", "--protocol", "4", "--json"],
      requiresHub: false,
    },
    canonicalAuthorities: versionThree.canonicalAuthorities,
    projections: [...versionThree.projections, "assignment_acknowledgements"],
    routes: [
      ...versionThree.routes.map((route) => {
        if (route.routeId === "assignment_thread.inspect") {
          return {
            ...route,
            contractVersion: 2 as const,
            resultContract: "assignment_communication_report_v2" as const,
            command: [
              "loop",
              "thread",
              "--contract",
              "2",
              "--assignment",
              "<assignment-id>",
              "--json",
            ],
          };
        }
        if (route.routeId === "assignment_inbox.inspect") {
          return {
            ...route,
            contractVersion: 2 as const,
            resultContract: "assignment_communication_report_v2" as const,
            command: ["loop", "inbox", "--contract", "2", "--agent", "<agent-id>", "--json"],
          };
        }
        return route;
      }),
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
    ],
    unsupported: versionThree.unsupported,
  };
}
