import type {
  ProductHostCapabilityReportV8,
  ProductHostCapabilityReportV9,
  ProductHostRouteV9,
} from "@lervo/application-contract";

const routes: ProductHostRouteV9[] = [
  {
    routeId: "product_search.inspect",
    area: "product",
    operation: "query",
    contractVersion: 1,
    resultContract: "product_unified_search_result_v1",
    command: ["application", "search", "--corpus", "repository_knowledge", "--json", "<query>"],
    output: "json",
    effect: "none",
    authority: "read_only",
    availability: "available",
  },
];

export function upgradeProductHostCapabilityReportV9(
  versionEight: ProductHostCapabilityReportV8,
): ProductHostCapabilityReportV9 {
  return {
    schemaVersion: 9,
    kind: "product_host.capabilities",
    protocol: {
      transport: "local_cli",
      version: 9,
      discoveryCommand: ["application", "capabilities", "--protocol", "9", "--json"],
      requiresHub: false,
    },
    canonicalAuthorities: versionEight.canonicalAuthorities,
    projections: [...versionEight.projections, "product_unified_search_v1"],
    routes: [...versionEight.routes, ...routes],
    unsupported: versionEight.unsupported,
  };
}
