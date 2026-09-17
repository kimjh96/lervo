import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import {
  type SurfaceObservabilityReportV1,
  type WorkExecutionReport,
  validateSchema,
} from "@lervo/schemas";

export interface WorkObservabilityProjectionInputV1 {
  surface: SurfaceObservabilityReportV1["surface"];
  sourceEventHeadHash: string;
  repositoryRevision: string;
  originCoordinate: string | null;
  stageCatalogVersion: number | null;
  stageCatalogConflict?: boolean;
  workReport: WorkExecutionReport;
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

function unavailableGrounding(): SurfaceObservabilityReportV1["grounding"] {
  const ratio = {
    numerator: null,
    denominator: null,
    value: null,
    reasonCode: "grounding_observation_unavailable",
  } as const;
  return {
    status: "unavailable",
    reasonCode: "grounding_observation_unavailable",
    sourceCoordinates: [],
    reportCoordinate: null,
    documentCounts: {
      recommended: null,
      selected: null,
      loaded: null,
      injected: null,
      referenced: null,
    },
    coverage: {
      delivery: ratio,
      explicitReference: ratio,
      relevance: ratio,
      candidateSelection: ratio,
    },
  };
}

function unavailableSearch(): SurfaceObservabilityReportV1["search"] {
  return {
    status: "unavailable",
    reasonCode: "search_observation_unavailable",
    sourceCoordinates: [],
    resultCoordinate: null,
    engine: null,
    queryDurationMs: null,
    orderedHitCoordinates: [],
  };
}

function reason(reasons: readonly string[], fallback: string): string {
  return reasons[0] ?? fallback;
}

function sectionStatus(value: WorkExecutionReport["resources"]["completeness"]) {
  return value;
}

function projectResources(report: WorkExecutionReport): SurfaceObservabilityReportV1["resources"] {
  const groups: SurfaceObservabilityReportV1["resources"]["groups"] = report.resources.groups.map(
    (group) => {
      const reasonCode = reason(group.missingReasons, "resource_observation_incomplete");
      const hasUsage = group.totalUsage !== null;
      const common = {
        provider: group.provider,
        scope: group.scope,
        accountingMode: group.accountingMode,
        accountingDescriptorHash: group.accountingDescriptorHash,
        sourceCoordinates: group.observations.map(
          (observation) => `resource:${observation.resourceObservationId}`,
        ),
      };
      if (group.completeness === "invalid")
        return { ...common, status: "invalid", usage: null, reasonCode };
      if (!hasUsage) return { ...common, status: "unavailable", usage: null, reasonCode };
      if (group.completeness === "complete")
        return { ...common, status: "observed", usage: group.totalUsage!, reasonCode: null };
      return { ...common, status: "partial", usage: group.totalUsage!, reasonCode };
    },
  );
  const status = sectionStatus(report.resources.completeness);
  return {
    status,
    reasonCode:
      status === "complete"
        ? null
        : reason(report.resources.missingReasons, "resource_observation_unavailable"),
    sourceCoordinates: groups.flatMap((group) => group.sourceCoordinates),
    groups,
  } as SurfaceObservabilityReportV1["resources"];
}

function projectStages(
  report: WorkExecutionReport,
  stageCatalogVersion: number | null,
  stageCatalogConflict: boolean,
): SurfaceObservabilityReportV1["stages"] {
  const profiles = new Set(report.stages.observations.map((item) => item.repositoryProfile));
  const environments = new Set(
    report.stages.observations.map((item) => item.environmentProfileDigest),
  );
  const incompatible = profiles.size > 1 || environments.size > 1 || stageCatalogConflict;
  const baseStatus = report.stages.completeness;
  const status = incompatible
    ? ("invalid" as const)
    : baseStatus === "complete" && stageCatalogVersion === null
      ? ("partial" as const)
      : baseStatus;
  const reasonCode =
    status === "complete"
      ? null
      : incompatible
        ? stageCatalogConflict
          ? "incompatible_stage_catalog_versions"
          : "incompatible_stage_profiles"
        : stageCatalogVersion === null && report.stages.observations.length > 0
          ? "stage_catalog_unavailable"
          : reason(report.stages.missingReasons, "stage_observation_unavailable");
  return {
    status,
    reasonCode,
    sourceCoordinates: report.stages.observations.map((item) => `stage:${item.observationSetId}`),
    stageCatalogVersion,
    environmentProfileDigest: incompatible
      ? null
      : (report.stages.observations[0]?.environmentProfileDigest ?? null),
    repositoryProfile: incompatible
      ? null
      : (report.stages.observations[0]?.repositoryProfile ?? null),
    observations: report.stages.observations.flatMap((item) =>
      item.stages.map((observation) => ({
        runCoordinate: `run:${item.runId}`,
        occurrenceCount: 1,
        observation,
      })),
    ),
  } as SurfaceObservabilityReportV1["stages"];
}

function projectCaches(
  report: WorkExecutionReport,
  repositoryRevision: string,
): SurfaceObservabilityReportV1["caches"] {
  const entries: SurfaceObservabilityReportV1["caches"]["entries"] = report.resources.groups.map(
    (group) => {
      const invalid = group.completeness === "invalid";
      const observed = group.totalUsage !== null;
      const common = {
        cacheKind: "provider:cached-input",
        owner: `provider:${createHash("sha256").update(group.provider).digest("hex").slice(0, 24)}`,
        unit: "tokens" as const,
        sourceRevision: repositoryRevision,
        buildCoordinate: group.accountingDescriptorHash,
        disposition: "unknown" as const,
      };
      if (invalid)
        return {
          ...common,
          status: "invalid",
          observedValue: null,
          reasonCode: reason(group.missingReasons, "cache_observation_invalid"),
        };
      if (!observed)
        return {
          ...common,
          status: "unavailable",
          observedValue: null,
          reasonCode: reason(group.missingReasons, "cache_observation_unavailable"),
        };
      return {
        ...common,
        status: "observed",
        observedValue: group.totalUsage!.cachedInputTokens,
        reasonCode: null,
      };
    },
  );
  const status = entries.some((entry) => entry.status === "invalid")
    ? ("invalid" as const)
    : entries.length === 0 || entries.every((entry) => entry.status === "unavailable")
      ? ("unavailable" as const)
      : entries.every((entry) => entry.status === "observed")
        ? ("complete" as const)
        : ("partial" as const);
  return {
    status,
    reasonCode: status === "complete" ? null : "cache_observation_incomplete",
    sourceCoordinates: report.resources.groups.flatMap((group) =>
      group.observations.map((item) => `resource:${item.resourceObservationId}`),
    ),
    entries,
  } as SurfaceObservabilityReportV1["caches"];
}

function projectResult(report: WorkExecutionReport): SurfaceObservabilityReportV1["result"] {
  const terminalStatus = report.runs.some((run) => run.status === "failed")
    ? ("failed" as const)
    : report.runs.length > 0 && report.runs.every((run) => run.status === "completed")
      ? ("completed" as const)
      : ("unknown" as const);
  return {
    status: "partial",
    reasonCode: "result_details_unavailable",
    sourceCoordinates: report.runs.map((run) => `run:${run.runId}`),
    terminalStatus,
    verificationStatus: "unavailable",
    acceptanceStatus: "unavailable",
    artifactStatus: "unavailable",
    publicationStatus: "not_requested",
    deliveryStatus: "not_requested",
    resultDigest: null,
    artifactCoordinates: [],
    verificationCoordinate: null,
    acceptanceCoordinate: null,
    publicationCoordinate: null,
    deliveryCoordinate: null,
  };
}

export function projectWorkObservability(
  input: WorkObservabilityProjectionInputV1,
): SurfaceObservabilityReportV1 {
  const resources = projectResources(input.workReport);
  const stages = projectStages(
    input.workReport,
    input.stageCatalogVersion,
    input.stageCatalogConflict ?? false,
  );
  const caches = projectCaches(input.workReport, input.repositoryRevision);
  const result = projectResult(input.workReport);
  const required = [resources, stages, caches, result];
  const status = required.some((section) => section.status === "invalid")
    ? ("invalid" as const)
    : required.every((section) => section.status === "unavailable")
      ? ("unavailable" as const)
      : required.every((section) => section.status === "complete")
        ? ("complete" as const)
        : ("partial" as const);
  const missingReasons = [resources, stages, caches, result].flatMap((section) =>
    section.reasonCode === null ? [] : [section.reasonCode],
  );
  const report = {
    schemaVersion: 1 as const,
    kind: "product_surface.observability" as const,
    surface: input.surface,
    sourceEventHeadHash: input.sourceEventHeadHash,
    repositoryRevision: input.repositoryRevision,
    workCoordinate: `work:${input.workReport.workId}`,
    originCoordinate: input.originCoordinate,
    grounding: unavailableGrounding(),
    search: unavailableSearch(),
    resources,
    stages,
    caches,
    result,
    completeness: {
      requiredSections: ["resources", "stages", "caches", "result"] as Array<
        "resources" | "stages" | "caches" | "result"
      >,
      missingReasons: [...new Set(missingReasons)],
    },
    status,
  };
  const output = { ...report, reportDigest: digest(report) };
  const validation = validateSchema("surfaceObservabilityReport", output);
  if (!validation.valid) {
    throw new Error("The projected work observability report violates its canonical schema.");
  }
  return output;
}
