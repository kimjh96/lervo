import type {
  ProductHostCapabilityReportV9,
  ProductHostCapabilityReportV10,
  ProductHostRouteV10,
} from "@lervo/application-contract";

const routes: ProductHostRouteV10[] = [
  {
    routeId: "product_observability.inspect",
    area: "product",
    operation: "query",
    contractVersion: 1,
    resultContract: "surface_observability_report_v1",
    command: ["application", "observability", "--work", "<work-id>", "--json"],
    output: "json",
    effect: "none",
    authority: "read_only",
    availability: "available",
  },
];

export function upgradeProductHostCapabilityReportV10(
  versionNine: ProductHostCapabilityReportV9,
): ProductHostCapabilityReportV10 {
  return {
    schemaVersion: 10,
    kind: "product_host.capabilities",
    protocol: {
      transport: "local_cli",
      version: 10,
      discoveryCommand: ["application", "capabilities", "--protocol", "10", "--json"],
      requiresHub: false,
    },
    canonicalAuthorities: versionNine.canonicalAuthorities,
    projections: [...versionNine.projections, "surface_observability_v1"],
    routes: [...versionNine.routes, ...routes],
    unsupported: versionNine.unsupported,
  };
}
