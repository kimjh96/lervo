import type {
  ProductHostCapabilityReportV4,
  ProductHostCapabilityReportV5,
} from "@lervo/application-contract";

export function upgradeProductHostCapabilityReportV5(
  versionFour: ProductHostCapabilityReportV4,
): ProductHostCapabilityReportV5 {
  return {
    schemaVersion: 5,
    kind: "product_host.capabilities",
    protocol: {
      transport: "local_cli",
      version: 5,
      discoveryCommand: ["application", "capabilities", "--protocol", "5", "--json"],
      requiresHub: false,
    },
    canonicalAuthorities: versionFour.canonicalAuthorities,
    projections: versionFour.projections,
    routes: [
      ...versionFour.routes,
      {
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
      },
    ],
    unsupported: [
      "product_ui",
      "product_database",
      "dynamic_graph_mutation",
      "implicit_approval",
      "unmanaged_terminal_execution",
    ],
  };
}
