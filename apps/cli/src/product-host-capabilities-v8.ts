import type {
  ProductHostCapabilityReportV7,
  ProductHostCapabilityReportV8,
  ProductHostRouteV8,
} from "@lervo/application-contract";

const routes: ProductHostRouteV8[] = [
  {
    routeId: "product_activity.inspect",
    area: "product",
    operation: "query",
    contractVersion: 1,
    resultContract: "product_activity_page_v1",
    command: ["application", "activity", "--json"],
    output: "json",
    effect: "none",
    authority: "read_only",
    availability: "available",
  },
];

export function upgradeProductHostCapabilityReportV8(
  versionSeven: ProductHostCapabilityReportV7,
): ProductHostCapabilityReportV8 {
  return {
    schemaVersion: 8,
    kind: "product_host.capabilities",
    protocol: {
      transport: "local_cli",
      version: 8,
      discoveryCommand: ["application", "capabilities", "--protocol", "8", "--json"],
      requiresHub: false,
    },
    canonicalAuthorities: versionSeven.canonicalAuthorities,
    projections: [...versionSeven.projections, "product_activity_v1"],
    routes: [...versionSeven.routes, ...routes],
    unsupported: versionSeven.unsupported,
  };
}
