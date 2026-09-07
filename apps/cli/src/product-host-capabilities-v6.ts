import type {
  ProductHostCapabilityReportV5,
  ProductHostCapabilityReportV6,
} from "@lervo/application-contract";

export function upgradeProductHostCapabilityReportV6(
  versionFive: ProductHostCapabilityReportV5,
): ProductHostCapabilityReportV6 {
  return {
    schemaVersion: 6,
    kind: "product_host.capabilities",
    protocol: {
      transport: "local_cli",
      version: 6,
      discoveryCommand: ["application", "capabilities", "--protocol", "6", "--json"],
      requiresHub: false,
    },
    canonicalAuthorities: versionFive.canonicalAuthorities,
    projections: [...versionFive.projections, "assignment_graph_v2"],
    routes: [
      ...versionFive.routes,
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
    ],
    unsupported: [
      "product_ui",
      "product_database",
      "implicit_approval",
      "unmanaged_terminal_execution",
    ],
  };
}
