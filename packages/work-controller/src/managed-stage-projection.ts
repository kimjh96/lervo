import {
  assertExecutionStageSet,
  resourceScopeForRelationship,
  type WorkCausalityRecord,
} from "@lervo/execution-contract";
import {
  managedExecutionStages,
  type ManagedExecutionStageV1,
  type ManagedStageGroupObservationV1,
} from "@lervo/application-contract";
import {
  validateSchema,
  type EventEnvelope,
  type ExecutionStagesObservedEventPayload,
} from "@lervo/schemas";

type ManagedProvider = ManagedStageGroupObservationV1["provider"];

function managedProvider(value: string | undefined): value is ManagedProvider {
  return value === "codex" || value === "claude";
}

export function projectManagedStageGroups(input: {
  events: readonly EventEnvelope[];
  workRuns: readonly WorkCausalityRecord[];
}): ManagedStageGroupObservationV1[] {
  const workRunIds = new Set(input.workRuns.map((record) => record.runId));
  const workByRun = new Map(input.workRuns.map((record) => [record.runId, record]));
  const providerByRun = new Map<string, ManagedProvider>();
  for (const event of input.events.filter(
    (candidate) => candidate.type === "adapter.started" && workRunIds.has(candidate.runId),
  )) {
    if (!managedProvider(event.actor.provider)) {
      throw new TypeError("A managed stage run has an invalid adapter provider.");
    }
    const existing = providerByRun.get(event.runId);
    if (existing !== undefined && existing !== event.actor.provider) {
      throw new TypeError("A managed stage run has contradictory adapter providers.");
    }
    providerByRun.set(event.runId, event.actor.provider);
  }

  const setByRun = new Map<string, ExecutionStagesObservedEventPayload>();
  const setById = new Map<
    string,
    { runId: string; payload: ExecutionStagesObservedEventPayload }
  >();
  for (const event of input.events.filter(
    (candidate) =>
      candidate.type === "execution.stages.observed" && workRunIds.has(candidate.runId),
  )) {
    if (!validateSchema("executionStagesObservedEventPayload", event.payload).valid) {
      throw new TypeError("A governed managed-stage observation is invalid.");
    }
    const payload = event.payload as ExecutionStagesObservedEventPayload;
    assertExecutionStageSet(payload.stages);
    const run = workByRun.get(event.runId)!;
    if (payload.executionMode !== "managed" || payload.workId !== run.payload.workId) {
      throw new TypeError(
        "A governed managed-stage observation differs from its causal work tree.",
      );
    }
    if (
      payload.stages.some(
        (stage) => !managedExecutionStages.includes(stage.stageId as ManagedExecutionStageV1),
      )
    ) {
      throw new TypeError("A managed run reported a terminal-only execution stage.");
    }
    const existingSet = setById.get(payload.observationSetId);
    if (
      existingSet !== undefined &&
      JSON.stringify(existingSet) !== JSON.stringify({ runId: event.runId, payload })
    ) {
      throw new TypeError("A governed managed-stage observation is contradictory.");
    }
    const existingRun = setByRun.get(event.runId);
    if (existingRun !== undefined && existingRun.observationSetId !== payload.observationSetId) {
      throw new TypeError("A governed run has more than one managed-stage observation set.");
    }
    setById.set(payload.observationSetId, { runId: event.runId, payload });
    setByRun.set(event.runId, payload);
  }

  const groups = new Map<string, ManagedStageGroupObservationV1["observations"]>();
  for (const [runId, payload] of setByRun) {
    const provider = providerByRun.get(runId);
    if (provider === undefined) continue;
    const run = workByRun.get(runId)!;
    const scope = resourceScopeForRelationship(run.payload.relationship);
    for (const stage of payload.stages) {
      const stageId = stage.stageId as ManagedExecutionStageV1;
      const key = `${provider}\0${scope}\0${stageId}`;
      const group = groups.get(key) ?? [];
      group.push({
        runId,
        environmentProfileDigest: payload.environmentProfileDigest,
        durationMs: stage.durationMs,
        outcome: stage.outcome,
      });
      groups.set(key, group);
    }
  }

  const expectedRuns = input.workRuns.flatMap((record) => {
    const provider = providerByRun.get(record.runId);
    return provider === undefined
      ? []
      : [
          {
            runId: record.runId,
            provider,
            scope: resourceScopeForRelationship(record.payload.relationship),
          },
        ];
  });
  return [...groups.entries()]
    .map<ManagedStageGroupObservationV1>(([key, observations]) => {
      const [provider, scope, stageId] = key.split("\0") as [
        ManagedProvider,
        ManagedStageGroupObservationV1["scope"],
        ManagedExecutionStageV1,
      ];
      const observedRuns = new Set(observations.map((observation) => observation.runId));
      const missing = expectedRuns.some(
        (run) => run.provider === provider && run.scope === scope && !observedRuns.has(run.runId),
      );
      return {
        schemaVersion: 1,
        provider,
        scope,
        stageId,
        completeness: missing ? "partial" : "complete",
        observations: observations.sort((left, right) => left.runId.localeCompare(right.runId)),
        runCount: observations.length,
        reasonCodes: missing ? ["stage_observation_missing"] : [],
      };
    })
    .sort((left, right) =>
      `${left.provider}\0${left.scope}\0${left.stageId}`.localeCompare(
        `${right.provider}\0${right.scope}\0${right.stageId}`,
      ),
    );
}
