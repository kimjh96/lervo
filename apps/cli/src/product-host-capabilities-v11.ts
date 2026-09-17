import type {
  ProductHostCapabilityReportV10,
  ProductHostCapabilityReportV11,
  ProductHostRouteV11,
} from "@lervo/application-contract";

const routes: ProductHostRouteV11[] = [
  {
    routeId: "product_deliberation.inspect",
    area: "product",
    operation: "query",
    contractVersion: 1,
    resultContract: "product_deliberation_view_v1",
    command: [
      "application",
      "deliberation",
      "--deliberation",
      "<deliberation-id>",
      "--integration",
      "<integration-id>",
      "--json",
    ],
    output: "json",
    effect: "none",
    authority: "read_only",
    availability: "available",
  },
];

export function upgradeProductHostCapabilityReportV11(
  versionTen: ProductHostCapabilityReportV10,
): ProductHostCapabilityReportV11 {
  return {
    schemaVersion: 11,
    kind: "product_host.capabilities",
    protocol: {
      transport: "local_cli",
      version: 11,
      discoveryCommand: ["application", "capabilities", "--protocol", "11", "--json"],
      requiresHub: false,
    },
    canonicalAuthorities: versionTen.canonicalAuthorities,
    projections: [...versionTen.projections, "product_deliberation_v1"],
    routes: [...versionTen.routes, ...routes],
    unsupported: versionTen.unsupported,
  };
}
