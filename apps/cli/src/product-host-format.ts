import type { ProductHostCapabilityReport } from "@lervo/application-contract";
import type {
  ProductActivityPageV1,
  ProductDeliberationViewV1,
  ProductUnifiedSearchResultV1,
  SurfaceObservabilityReportV1,
} from "@lervo/schemas";

export function formatProductActivity(page: ProductActivityPageV1): string {
  return [
    `Lervo activity · ${page.status} · ${page.items.length} item(s)`,
    `event head: ${page.sourceEventHeadHash}`,
    `repository: ${page.repositoryRevision}`,
    ...page.items.map(
      (item) =>
        `  ${item.observedAt} · ${item.actor.coordinate} · ${item.actionClass} · ${item.object.kind} · ${item.outcome}`,
    ),
    `next cursor: ${page.nextCursor ?? "none"}`,
    ...(page.failureCode === null ? [] : [`failure: ${page.failureCode}`]),
    "",
  ].join("\n");
}

export function formatProductSearch(result: ProductUnifiedSearchResultV1): string {
  return [
    `Lervo product search · ${result.status} · ${result.groups.reduce((count, group) => count + group.hits.length, 0)} hit(s)`,
    `engine: ${result.searchPlan.engineId}-v${result.searchPlan.engineVersion}`,
    `repository: ${result.repositoryRevision}`,
    ...result.groups.flatMap((group) => [
      `  ${group.corpusClass} · ${group.status}`,
      ...group.hits.map(
        (hit) => `    ${hit.rank.toString().padStart(2)} · ${hit.label} · ${hit.sourceCoordinate}`,
      ),
    ]),
    ...(result.reasonCode === null ? [] : [`reason: ${result.reasonCode}`]),
    "",
  ].join("\n");
}

export function formatProductObservability(report: SurfaceObservabilityReportV1): string {
  return [
    `Lervo work observability · ${report.status} · ${report.workCoordinate ?? "unbound"}`,
    `event head: ${report.sourceEventHeadHash}`,
    `repository: ${report.repositoryRevision}`,
    `resources: ${report.resources.status} · ${report.resources.groups.length} group(s)`,
    ...report.resources.groups.map(
      (group) =>
        `  ${group.provider} · ${group.scope} · ${group.status} · input=${group.usage?.inputTokens ?? "unavailable"} cached=${group.usage?.cachedInputTokens ?? "unavailable"} output=${group.usage?.outputTokens ?? "unavailable"}`,
    ),
    `stages: ${report.stages.status} · ${report.stages.observations.length} observation(s) · catalog=${report.stages.stageCatalogVersion ?? "unavailable"}`,
    `caches: ${report.caches.status} · ${report.caches.entries.length} entry/entries`,
    `result: ${report.result.status} · terminal=${report.result.terminalStatus}`,
    ...(report.completeness.missingReasons.length === 0
      ? []
      : [`missing: ${report.completeness.missingReasons.join(", ")}`]),
    "",
  ].join("\n");
}

export function formatProductDeliberation(view: ProductDeliberationViewV1): string {
  return [
    `Lervo deliberation · ${view.status} · ${view.deliberationId}`,
    `projection: ${view.projectionStatus}${view.projectionReasonCode === null ? "" : ` · ${view.projectionReasonCode}`}`,
    `policy: ${view.policyId} · round ${view.round}/${view.maximumRounds}`,
    `participants: ${view.participants.length} · artifacts: ${view.artifacts.length} · verifications: ${view.verifications.length}`,
    `resources: ${view.resourceReportCoordinate ?? "unavailable"}`,
    `publication: ${view.publicationCoordinate ?? "unavailable"}`,
    `origin delivery: ${view.originDeliveryCoordinate ?? "unavailable"}`,
    "",
  ].join("\n");
}

export function formatProductHostCapabilities(report: ProductHostCapabilityReport): string {
  return [
    `Lervo product-host protocol v${report.protocol.version}`,
    `transport: ${report.protocol.transport}`,
    `Hub required: ${report.protocol.requiresHub ? "yes" : "no"}`,
    "routes:",
    ...report.routes.map(
      (route) =>
        `  ${route.routeId} · ${route.operation} · ${route.authority} · lervo ${route.command.join(" ")}`,
    ),
    `unsupported: ${report.unsupported.join(", ")}`,
    "",
  ].join("\n");
}
