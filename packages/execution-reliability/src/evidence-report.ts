import { createHash } from "node:crypto";

import { assertCompleteEffectInventory } from "@lervo/execution-contract";

import {
  assertGrowingCollectionCoverage,
  foundationCapacityProfiles,
  foundationGrowingCollections,
} from "./capacity-contract.js";
import { foundationRehearsals } from "./compatibility-rehearsals.js";
import { foundationEffectInventory } from "./effect-inventory.js";
import { createRecoveryMatrix } from "./recovery-matrix.js";
import {
  assertFoundationThreatModel,
  createEventTelemetryRegistry,
  foundationThreatModel,
} from "./security-privacy.js";

export interface CapacityProfileObservation {
  profileId: "small" | "medium" | "large" | "concurrent";
  eventWindow: number;
  assignmentWindow: number;
  concurrentWorkers: number;
  durationMs: number;
  cpuMs: number;
  processPeakResidentMemoryBytes: number;
  status: "passed";
}

export interface EvidenceSuiteBinding {
  area: "recovery" | "concurrency" | "security" | "compatibility";
  path: string;
  sourceHash: string;
}

export interface FoundationAdverseEvidenceReport {
  schemaVersion: 1;
  reportId: string;
  evidenceBuildDigest: string;
  repositoryRevision: string;
  environment: { operatingSystem: string; architecture: string; nodeVersion: string };
  effects: typeof foundationEffectInventory;
  recoveryScenarios: ReturnType<typeof createRecoveryMatrix>;
  telemetry: { eventTypeCount: number; fieldCount: number; registryDigest: string };
  threats: typeof foundationThreatModel;
  growingCollections: typeof foundationGrowingCollections;
  capacityProfiles: CapacityProfileObservation[];
  rehearsals: typeof foundationRehearsals;
  evidenceSuites: EvidenceSuiteBinding[];
  thirdPartyExtensions: "disabled_pending_isolation";
  allPassed: boolean;
  privacy: {
    prompts: "excluded";
    outputs: "excluded";
    credentials: "excluded";
    absolutePaths: "excluded";
  };
}

const protocol = {
  schemaVersion: 1,
  effectSemantics: "exact_completion_rollback_or_recovery_required_v1",
  telemetry: "closed_event_allowlist_field_registry_v1",
  threatModel: "integrated_untrusted_inputs_v1",
  capacity: "bounded_or_explicit_lifetime_v1",
  compatibility: "upgrade_rollback_migration_drift_v1",
} as const;

export const FOUNDATION_ADVERSE_EVIDENCE_BUILD_DIGEST = digest(protocol);

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

function reportId(source: Omit<FoundationAdverseEvidenceReport, "reportId">): string {
  return `adverse_${createHash("sha256").update(stableJson(source)).digest("hex").slice(0, 24)}`;
}

function assertStaticContracts(): ReturnType<typeof createEventTelemetryRegistry> {
  assertCompleteEffectInventory(foundationEffectInventory);
  assertGrowingCollectionCoverage(
    foundationEffectInventory.flatMap((effect) => effect.growingCollectionIds),
  );
  assertFoundationThreatModel();
  return createEventTelemetryRegistry();
}

export function createFoundationAdverseEvidenceReport(input: {
  repositoryRevision: string;
  environment: FoundationAdverseEvidenceReport["environment"];
  capacityProfiles: CapacityProfileObservation[];
  evidenceSuites: EvidenceSuiteBinding[];
}): FoundationAdverseEvidenceReport {
  const telemetryRegistry = assertStaticContracts();
  const recoveryScenarios = createRecoveryMatrix(foundationEffectInventory);
  const allPassed =
    recoveryScenarios.every((item) => item.status === "passed") &&
    input.capacityProfiles.length === foundationCapacityProfiles.length &&
    input.capacityProfiles.every((item) => item.status === "passed") &&
    new Set(input.evidenceSuites.map((item) => item.area)).size === 4;
  const source: Omit<FoundationAdverseEvidenceReport, "reportId"> = {
    schemaVersion: 1,
    evidenceBuildDigest: FOUNDATION_ADVERSE_EVIDENCE_BUILD_DIGEST,
    repositoryRevision: input.repositoryRevision,
    environment: structuredClone(input.environment),
    effects: structuredClone(foundationEffectInventory),
    recoveryScenarios,
    telemetry: {
      eventTypeCount: new Set(telemetryRegistry.map((item) => item.eventType)).size,
      fieldCount: telemetryRegistry.length,
      registryDigest: digest(telemetryRegistry),
    },
    threats: structuredClone(foundationThreatModel),
    growingCollections: structuredClone(foundationGrowingCollections),
    capacityProfiles: structuredClone(input.capacityProfiles),
    rehearsals: structuredClone(foundationRehearsals),
    evidenceSuites: [...input.evidenceSuites].sort((left, right) =>
      left.path.localeCompare(right.path),
    ),
    thirdPartyExtensions: "disabled_pending_isolation",
    allPassed,
    privacy: {
      prompts: "excluded",
      outputs: "excluded",
      credentials: "excluded",
      absolutePaths: "excluded",
    },
  };
  return { ...source, reportId: reportId(source) };
}

export function verifyFoundationAdverseEvidenceReport(
  value: unknown,
): FoundationAdverseEvidenceReport {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("The foundation adverse-condition report is invalid.");
  }
  const report = value as FoundationAdverseEvidenceReport;
  const telemetryRegistry = assertStaticContracts();
  const expectedScenarios = createRecoveryMatrix(foundationEffectInventory);
  const { reportId: actualReportId, ...source } = report;
  if (
    report.schemaVersion !== 1 ||
    report.evidenceBuildDigest !== FOUNDATION_ADVERSE_EVIDENCE_BUILD_DIGEST ||
    !/^sha256:[a-f0-9]{64}$/u.test(report.repositoryRevision) ||
    !/^adverse_[a-f0-9]{24}$/u.test(actualReportId) ||
    actualReportId !== reportId(source) ||
    JSON.stringify(report.effects) !== JSON.stringify(foundationEffectInventory) ||
    JSON.stringify(report.recoveryScenarios) !== JSON.stringify(expectedScenarios) ||
    JSON.stringify(report.threats) !== JSON.stringify(foundationThreatModel) ||
    JSON.stringify(report.growingCollections) !== JSON.stringify(foundationGrowingCollections) ||
    JSON.stringify(report.rehearsals) !== JSON.stringify(foundationRehearsals) ||
    report.telemetry.eventTypeCount !==
      new Set(telemetryRegistry.map((item) => item.eventType)).size ||
    report.telemetry.fieldCount !== telemetryRegistry.length ||
    report.telemetry.registryDigest !== digest(telemetryRegistry) ||
    report.capacityProfiles.length !== foundationCapacityProfiles.length ||
    report.capacityProfiles.some((observation, index) => {
      const profile = foundationCapacityProfiles[index];
      return (
        observation.profileId !== profile?.profileId ||
        observation.eventWindow !== profile.eventWindow ||
        observation.assignmentWindow !== profile.assignmentWindow ||
        observation.concurrentWorkers !== profile.concurrentWorkers ||
        observation.status !== "passed" ||
        !Number.isFinite(observation.durationMs) ||
        observation.durationMs < 0 ||
        !Number.isFinite(observation.cpuMs) ||
        observation.cpuMs < 0 ||
        !Number.isSafeInteger(observation.processPeakResidentMemoryBytes) ||
        observation.processPeakResidentMemoryBytes < 1
      );
    }) ||
    report.evidenceSuites.length < 12 ||
    report.evidenceSuites.some(
      (item) => !/^sha256:[a-f0-9]{64}$/u.test(item.sourceHash) || !item.path.includes("/test/"),
    ) ||
    new Set(report.evidenceSuites.map((item) => item.area)).size !== 4 ||
    report.thirdPartyExtensions !== "disabled_pending_isolation" ||
    report.privacy?.prompts !== "excluded" ||
    report.privacy.outputs !== "excluded" ||
    report.privacy.credentials !== "excluded" ||
    report.privacy.absolutePaths !== "excluded" ||
    !report.allPassed
  ) {
    throw new TypeError("The foundation adverse-condition report does not satisfy FH4.");
  }
  return structuredClone(report);
}
