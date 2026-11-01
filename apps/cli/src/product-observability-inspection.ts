import { collectWorkExecutionEvents } from "@lervo/diagnostics";
import { projectWorkExecutionReport } from "@lervo/execution-observability";
import { captureRepositorySnapshot } from "@lervo/orchestrator";
import { projectWorkObservability } from "@lervo/product-surface-projection";
import { openReadOnlyProjectStorage } from "@lervo/project-storage";
import {
  type EventEnvelope,
  type ExecutionStagesObservedEventPayload,
  type SurfaceObservabilityReportV1,
  validateSchema,
} from "@lervo/schemas";
import type { EventChainReport, ListEventsOptions } from "@lervo/storage-contract";

interface ObservabilityEventSource {
  list(options?: ListEventsOptions): EventEnvelope[];
  verifyIntegrity(): EventChainReport;
}

interface ObservabilityStorage {
  readonly manifest: { projectId: string };
  readonly events: ObservabilityEventSource;
  close(): Promise<void>;
}

interface ProductObservabilityInspectionDependencies {
  openStorage(root: string): Promise<ObservabilityStorage>;
  captureSnapshot(root: string): Promise<{ revision: string }>;
}

export interface ProductObservabilityInspectionInput {
  repositoryRoot: string;
  workId: string;
  originCoordinate: string | null;
}

export type InspectProductObservability = (
  input: ProductObservabilityInspectionInput,
) => Promise<SurfaceObservabilityReportV1>;

const defaultDependencies: ProductObservabilityInspectionDependencies = {
  openStorage: openReadOnlyProjectStorage,
  captureSnapshot: captureRepositorySnapshot,
};

/**
 * Reads the work's events through the verified head. Only the work's runs and causal records are
 * retained, so the read is bounded by the work, not by the length of project history.
 */
function readVerifiedWorkEvents(
  source: ObservabilityEventSource,
  integrity: EventChainReport,
  workId: string,
) {
  const events = collectWorkExecutionEvents({
    events: source,
    workId,
    throughSeq: integrity.eventCount,
  });
  const head = source.list({ afterSeq: integrity.eventCount - 1, limit: 1 })[0];
  if (head?.seq !== integrity.eventCount || head.eventHash !== integrity.headHash) {
    throw new Error("The verified event head changed while observability was being inspected.");
  }
  return events;
}

function observeStageCatalog(
  events: readonly EventEnvelope[],
  workId: string,
  workRunIds: ReadonlySet<string>,
) {
  const versions = new Set<number>();
  for (const event of events) {
    if (event.type !== "execution.stages.observed") continue;
    const validation = validateSchema("executionStagesObservedEventPayload", event.payload);
    if (!validation.valid) continue;
    const payload = event.payload as ExecutionStagesObservedEventPayload;
    if (
      payload.executionMode === "managed" &&
      payload.workId === workId &&
      workRunIds.has(event.runId)
    ) {
      versions.add(payload.stageCatalogVersion);
    }
  }
  return {
    stageCatalogVersion: versions.size === 1 ? [...versions][0]! : null,
    stageCatalogConflict: versions.size > 1,
  };
}

export async function inspectProductObservability(
  input: ProductObservabilityInspectionInput,
  dependencies: ProductObservabilityInspectionDependencies = defaultDependencies,
): Promise<SurfaceObservabilityReportV1> {
  if (!/^wrk_[a-f0-9]{24}$/u.test(input.workId)) {
    throw new Error("The requested work ID is invalid.");
  }
  const storage = await dependencies.openStorage(input.repositoryRoot);
  try {
    const integrity = storage.events.verifyIntegrity();
    if (integrity.headHash === null || integrity.eventCount === 0) {
      throw new Error("No canonical events exist for product observability projection.");
    }
    const repositoryBefore = await dependencies.captureSnapshot(input.repositoryRoot);
    const events = readVerifiedWorkEvents(storage.events, integrity, input.workId);
    const workReport = projectWorkExecutionReport({
      projectId: storage.manifest.projectId,
      workId: input.workId,
      events,
    });
    const stageCatalog = observeStageCatalog(
      events,
      input.workId,
      new Set(workReport.runs.map((run) => run.runId)),
    );
    const repositoryAfter = await dependencies.captureSnapshot(input.repositoryRoot);
    if (repositoryAfter.revision !== repositoryBefore.revision) {
      throw new Error("Repository bytes changed during product observability inspection.");
    }
    return projectWorkObservability({
      surface: { kind: "local_cli", adapterBuild: "cli:product-observability-v1" },
      sourceEventHeadHash: integrity.headHash,
      repositoryRevision: repositoryBefore.revision,
      originCoordinate: input.originCoordinate,
      ...stageCatalog,
      workReport,
    });
  } finally {
    await storage.close();
  }
}
