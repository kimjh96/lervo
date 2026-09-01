import { assertExecutionStageSet, validateWorkCausalityHistory } from "@lervo/execution-contract";
import {
  type ExecutionStagesObservedEventPayload,
  type EventEnvelope,
  type ResourceUsage,
  type ResourceUsageRecordedEventPayload,
  type WorkExecutionReport,
  validateSchema,
} from "@lervo/schemas";

export type WorkExecutionReportErrorCode =
  "work_not_found" | "project_mismatch" | "resource_observation_invalid" | "report_invalid";

export class WorkExecutionReportError extends Error {
  constructor(
    readonly code: WorkExecutionReportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkExecutionReportError";
  }
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function usageTotal(values: readonly ResourceUsage[]): ResourceUsage {
  return values.reduce<ResourceUsage>(
    (total, usage) => ({
      inputTokens: total.inputTokens + usage.inputTokens,
      cachedInputTokens: total.cachedInputTokens + usage.cachedInputTokens,
      outputTokens: total.outputTokens + usage.outputTokens,
      reasoningOutputTokens: total.reasoningOutputTokens + usage.reasoningOutputTokens,
      totalTokens: total.totalTokens + usage.totalTokens,
      contextWindow:
        total.contextWindow === null
          ? usage.contextWindow
          : usage.contextWindow === null
            ? total.contextWindow
            : Math.max(total.contextWindow, usage.contextWindow),
    }),
    {
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
      contextWindow: null,
    },
  );
}

function completeness(statuses: readonly string[], missing: readonly string[]) {
  if (statuses.includes("invalid")) return "invalid" as const;
  if (statuses.length === 0 || statuses.every((status) => status === "unavailable")) {
    return "unavailable" as const;
  }
  if (missing.length > 0 || statuses.some((status) => status !== "observed")) {
    return "partial" as const;
  }
  return "complete" as const;
}

export function projectWorkExecutionReport(input: {
  projectId: string;
  workId: string;
  events: readonly EventEnvelope[];
}): WorkExecutionReport {
  if (input.events.some((event) => event.projectId !== input.projectId)) {
    throw new WorkExecutionReportError(
      "project_mismatch",
      "The work projection contains an event from another project.",
    );
  }
  const causality = validateWorkCausalityHistory(input.events);
  const runRecords = [...causality.values()].filter(
    (record) => record.payload.workId === input.workId,
  );
  if (runRecords.length === 0) {
    throw new WorkExecutionReportError("work_not_found", `Work ${input.workId} was not found.`);
  }
  const runIds = new Set(runRecords.map((record) => record.runId));
  const workEvents = input.events.filter((event) => runIds.has(event.runId));
  const runs = runRecords
    .map((record) => {
      const events = workEvents.filter((event) => event.runId === record.runId);
      const types = new Set(events.map((event) => event.type));
      const provider = events.find((event) => event.type === "adapter.started")?.actor.provider;
      return {
        runId: record.runId,
        sessionIds: uniqueSorted(events.map((event) => event.sessionId)),
        relationship: record.payload.relationship,
        parentRunId: record.payload.parentRunId,
        retryOfRunId: record.payload.retryOfRunId,
        attemptOrdinal: record.payload.attemptOrdinal,
        provider: provider ?? null,
        status: types.has("run.failed")
          ? ("failed" as const)
          : types.has("run.completed") || types.has("deliberation.completed")
            ? ("completed" as const)
            : ("incomplete" as const),
        firstOccurredAt: events[0]?.occurredAt ?? "1970-01-01T00:00:00.000Z",
        lastOccurredAt: events.at(-1)?.occurredAt ?? "1970-01-01T00:00:00.000Z",
      };
    })
    .sort((left, right) => left.firstOccurredAt.localeCompare(right.firstOccurredAt));

  const observationById = new Map<
    string,
    { runId: string; provider: string; payload: ResourceUsageRecordedEventPayload }
  >();
  const descriptorBySource = new Map<string, string>();
  for (const event of workEvents.filter((item) => item.type === "resource.usage.recorded")) {
    const validation = validateSchema("resourceUsageRecordedEventPayload", event.payload);
    const payload = event.payload as ResourceUsageRecordedEventPayload;
    const runProvider = runs.find((run) => run.runId === event.runId)?.provider ?? null;
    if (
      !validation.valid ||
      payload.workId !== input.workId ||
      (payload.source === "provider_reported" &&
        (event.actor.provider === undefined || event.actor.provider !== runProvider))
    ) {
      throw new WorkExecutionReportError(
        "resource_observation_invalid",
        `Run ${event.runId} has an invalid resource observation.`,
      );
    }
    const observation = {
      runId: event.runId,
      provider: event.actor.provider ?? runProvider ?? "lervo",
      payload,
    };
    const existing = observationById.get(payload.resourceObservationId);
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(observation)) {
        throw new WorkExecutionReportError(
          "resource_observation_invalid",
          `Resource observation ${payload.resourceObservationId} is contradictory.`,
        );
      }
      continue;
    }
    const knownDescriptor = descriptorBySource.get(payload.sourceCoordinateDigest);
    if (knownDescriptor !== undefined && knownDescriptor !== payload.accountingDescriptorHash) {
      throw new WorkExecutionReportError(
        "resource_observation_invalid",
        `Resource source ${payload.sourceCoordinateDigest} changed accounting descriptor.`,
      );
    }
    descriptorBySource.set(payload.sourceCoordinateDigest, payload.accountingDescriptorHash);
    observationById.set(payload.resourceObservationId, observation);
  }
  const observations = [...observationById.values()];
  const missingResourceRuns = runs
    .filter(
      (run) =>
        run.provider !== null &&
        !observations.some((observation) => observation.runId === run.runId),
    )
    .map(() => "resource_observation_missing");
  const groupMap = new Map<string, typeof observations>();
  for (const observation of observations) {
    const payload = observation.payload;
    const key = [
      observation.provider,
      payload.scope,
      payload.source,
      payload.accountingMode,
      payload.accountingDescriptorHash,
    ].join("\u0000");
    const group = groupMap.get(key) ?? [];
    group.push(observation);
    groupMap.set(key, group);
  }
  const groups = [...groupMap.values()]
    .map((group) => {
      const first = group[0]!;
      const statuses = group.map((item) => item.payload.status);
      const missingReasons = uniqueSorted(
        group.flatMap((item) =>
          item.payload.reasonCode === null ? [] : [item.payload.reasonCode],
        ),
      );
      const observedUsage = group.flatMap((item) =>
        item.payload.usage === null ? [] : [item.payload.usage],
      );
      return {
        provider: first.provider,
        scope: first.payload.scope,
        source: first.payload.source,
        accountingMode: first.payload.accountingMode,
        accountingDescriptorHash: first.payload.accountingDescriptorHash,
        completeness: completeness(statuses, missingReasons),
        missingReasons,
        observations: group
          .map((item) => ({
            runId: item.runId,
            resourceObservationId: item.payload.resourceObservationId,
            sourceCoordinateDigest: item.payload.sourceCoordinateDigest,
            status: item.payload.status,
            usage: item.payload.usage,
            reasonCode: item.payload.reasonCode,
          }))
          .sort((left, right) => left.runId.localeCompare(right.runId)),
        totalUsage: observedUsage.length === 0 ? null : usageTotal(observedUsage),
      };
    })
    .sort((left, right) =>
      [left.provider, left.scope, left.accountingDescriptorHash]
        .join("\u0000")
        .localeCompare(
          [right.provider, right.scope, right.accountingDescriptorHash].join("\u0000"),
        ),
    );
  const resourceReasons = uniqueSorted([
    ...missingResourceRuns,
    ...groups.flatMap((group) => group.missingReasons),
  ]);
  const resourceCompleteness = completeness(
    observations.map((item) => item.payload.status),
    resourceReasons,
  );
  const stageEvents = workEvents.filter((event) => event.type === "execution.stages.observed");
  const stageObservationById = new Map<
    string,
    { runId: string; payload: ExecutionStagesObservedEventPayload }
  >();
  const stageObservationIdByRun = new Map<string, string>();
  let invalidStage = false;
  for (const event of stageEvents) {
    if (!validateSchema("executionStagesObservedEventPayload", event.payload).valid) {
      invalidStage = true;
      continue;
    }
    const payload = event.payload as ExecutionStagesObservedEventPayload;
    try {
      assertExecutionStageSet(payload.stages);
    } catch {
      invalidStage = true;
      continue;
    }
    if (
      payload.executionMode !== "managed" ||
      payload.workId !== input.workId ||
      !runIds.has(event.runId)
    ) {
      invalidStage = true;
      continue;
    }
    const observation = { runId: event.runId, payload };
    const existing = stageObservationById.get(payload.observationSetId);
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(observation)) invalidStage = true;
      continue;
    }
    const runObservationId = stageObservationIdByRun.get(event.runId);
    if (runObservationId !== undefined && runObservationId !== payload.observationSetId) {
      invalidStage = true;
      continue;
    }
    stageObservationIdByRun.set(event.runId, payload.observationSetId);
    stageObservationById.set(payload.observationSetId, observation);
  }
  const stageObservations = [...stageObservationById.values()]
    .map((observation) => ({
      runId: observation.runId,
      observationSetId: observation.payload.observationSetId,
      environmentProfileDigest: observation.payload.environmentProfileDigest,
      repositoryProfile: observation.payload.repositoryProfile,
      stages: observation.payload.stages,
    }))
    .sort((left, right) => left.runId.localeCompare(right.runId));
  const missingStageRunCount = runs.filter((run) => !stageObservationIdByRun.has(run.runId)).length;
  const stageReasons = uniqueSorted([
    ...(invalidStage ? ["stage_observation_invalid"] : []),
    ...(missingStageRunCount > 0 ? ["stage_observation_missing"] : []),
  ]);
  const stageCompleteness = invalidStage
    ? "invalid"
    : stageObservations.length === 0
      ? "unavailable"
      : missingStageRunCount > 0
        ? "partial"
        : "complete";
  const missingReasons = uniqueSorted([...resourceReasons, ...stageReasons]);
  const report = {
    reportKind: "managed_work_execution",
    schemaVersion: 1,
    projectId: input.projectId,
    workId: input.workId,
    completeness:
      resourceCompleteness === "invalid" || stageCompleteness === "invalid"
        ? "invalid"
        : resourceCompleteness === "complete" && stageCompleteness === "complete"
          ? "complete"
          : "partial",
    missingReasons,
    runs,
    resources: {
      completeness: resourceCompleteness,
      missingReasons: resourceReasons,
      groups,
    },
    stages: {
      completeness: stageCompleteness,
      missingReasons: stageReasons,
      observationSetCount: stageObservations.length,
      observations: stageObservations,
    },
    cost: { status: "not_in_foundation_scope" },
  } as WorkExecutionReport;
  if (!validateSchema("workExecutionReport", report).valid) {
    throw new WorkExecutionReportError(
      "report_invalid",
      "The projected work execution report does not satisfy its schema.",
    );
  }
  return structuredClone(report);
}
