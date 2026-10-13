import {
  readResourceUsageEventPayload,
  resourceScopeForRelationship,
  type WorkCausalityRecord,
} from "@lervo/execution-contract";
import type { ResourceGroupObservationV1 } from "@lervo/application-contract";
import { type EventEnvelope, type ResourceUsageRecordedEventPayload } from "@lervo/schemas";

function resourceCompleteness(
  statuses: readonly ResourceUsageRecordedEventPayload["status"][],
): ResourceGroupObservationV1["completeness"] {
  if (statuses.some((status) => status === "invalid")) return "invalid";
  if (statuses.length === 0 || statuses.every((status) => status === "unavailable")) {
    return "unavailable";
  }
  if (statuses.some((status) => status !== "observed")) return "partial";
  return "complete";
}

/** Failure codes of managed-run phases that precede the provider adapter's start. */
const PRE_START_FAILURES = [
  "contract_validation_failed",
  "approval_required",
  "repository_snapshot_failed",
  "provider_start_failed",
];

export function projectManagedResourceGroups(input: {
  events: readonly EventEnvelope[];
  workRuns: readonly WorkCausalityRecord[];
}): ResourceGroupObservationV1[] {
  const workRunIds = new Set(input.workRuns.map((record) => record.runId));
  const workByRun = new Map(input.workRuns.map((record) => [record.runId, record.payload.workId]));
  const expectedScopeByRun = new Map(
    input.workRuns.map((record) => [
      record.runId,
      resourceScopeForRelationship(record.payload.relationship),
    ]),
  );
  const runProviders = new Map<string, string | undefined>();
  const failedStarts = new Map<string, EventEnvelope | null>();
  const observedProcesses = new Set<string>();
  const stoppedAdapters = new Set<string>();
  for (const event of input.events) {
    if (event.type === "provider.process.observed") observedProcesses.add(event.runId);
    if (event.type === "adapter.stopped") stoppedAdapters.add(event.runId);
    if (
      event.type === "run.failed" &&
      event.actor.kind === "system" &&
      PRE_START_FAILURES.includes(String(event.payload.failureCode)) &&
      event.payload.retryable === false
    )
      failedStarts.set(event.runId, failedStarts.has(event.runId) ? null : event);
  }
  for (const event of input.events.filter(
    (candidate) => candidate.type === "adapter.started" && workRunIds.has(candidate.runId),
  )) {
    const existing = runProviders.get(event.runId);
    if (runProviders.has(event.runId) && existing !== event.actor.provider) {
      throw new TypeError("A governed run has contradictory adapter providers.");
    }
    runProviders.set(event.runId, event.actor.provider);
  }
  const observations = input.events
    .filter((event) => event.type === "resource.usage.recorded" && workRunIds.has(event.runId))
    .map((event) => {
      const payload = readResourceUsageEventPayload(event);
      if (payload === null) {
        throw new TypeError("A governed work resource observation is invalid.");
      }
      const provider = event.actor.provider ?? "lervo";
      const failedStart = failedStarts.get(event.runId);
      // A terminal pre-start failure can report unavailable usage without an adapter-start receipt.
      const unavailableBeforeStart =
        !runProviders.has(event.runId) &&
        !observedProcesses.has(event.runId) &&
        !stoppedAdapters.has(event.runId) &&
        failedStart !== null &&
        failedStart !== undefined &&
        failedStart.seq > event.seq &&
        payload.status === "unavailable" &&
        payload.usage === null &&
        payload.reasonCode === "resource_observation_missing" &&
        payload.modelIdentity?.provider === provider;
      if (payload.workId !== workByRun.get(event.runId)) {
        throw new TypeError("A governed resource observation differs from its causal work tree.");
      }
      if (
        payload.source === "provider_reported" &&
        (provider === "lervo" ||
          (runProviders.get(event.runId) !== provider && !unavailableBeforeStart))
      ) {
        throw new TypeError("A provider resource observation differs from its run provider.");
      }
      if (
        payload.source === "provider_reported" &&
        expectedScopeByRun.get(event.runId) !== payload.scope
      ) {
        throw new TypeError("A provider resource observation differs from its causal scope.");
      }
      return { runId: event.runId, provider, payload };
    });
  const byObservationId = new Map<string, (typeof observations)[number]>();
  for (const observation of observations) {
    const existing = byObservationId.get(observation.payload.resourceObservationId);
    if (existing !== undefined && JSON.stringify(existing) !== JSON.stringify(observation)) {
      throw new TypeError("A governed work resource observation is contradictory.");
    }
    byObservationId.set(observation.payload.resourceObservationId, observation);
  }
  const descriptorBySource = new Map<string, string>();
  const observationByRun = new Set<string>();
  for (const observation of byObservationId.values()) {
    const descriptor = descriptorBySource.get(observation.payload.sourceCoordinateDigest);
    if (descriptor !== undefined && descriptor !== observation.payload.accountingDescriptorHash) {
      throw new TypeError("A governed resource source changed accounting descriptor.");
    }
    descriptorBySource.set(
      observation.payload.sourceCoordinateDigest,
      observation.payload.accountingDescriptorHash,
    );
    const runKey = [
      observation.runId,
      observation.provider,
      observation.payload.scope,
      observation.payload.source,
    ].join("\0");
    if (observationByRun.has(runKey)) {
      throw new TypeError("A governed run has more than one final resource observation.");
    }
    observationByRun.add(runKey);
  }
  const groups = new Map<string, (typeof observations)[number][]>();
  for (const observation of byObservationId.values()) {
    const key = [
      observation.provider,
      observation.payload.scope,
      observation.payload.source,
      observation.payload.accountingMode,
      observation.payload.accountingDescriptorHash,
    ].join("\0");
    const group = groups.get(key) ?? [];
    group.push(observation);
    groups.set(key, group);
  }
  const providerObservedRuns = new Set(
    [...byObservationId.values()]
      .filter(({ payload }) => payload.source === "provider_reported")
      .map(({ runId }) => runId),
  );
  const missingProviderRuns = input.workRuns.filter(
    (record) => runProviders.has(record.runId) && !providerObservedRuns.has(record.runId),
  );
  return [...groups.values()]
    .map<ResourceGroupObservationV1>((group) => {
      const first = group[0]!;
      const missesMatchingScope = missingProviderRuns.some(
        (record) =>
          first.payload.source === "provider_reported" &&
          runProviders.get(record.runId) === first.provider &&
          resourceScopeForRelationship(record.payload.relationship) === first.payload.scope,
      );
      const observedCompleteness = resourceCompleteness(group.map(({ payload }) => payload.status));
      const completeness =
        missesMatchingScope && observedCompleteness === "complete"
          ? "partial"
          : observedCompleteness;
      const tokenUsage = group.reduce(
        (total, { payload }) => ({
          inputTokens: total.inputTokens + (payload.usage?.inputTokens ?? 0),
          cachedInputTokens: total.cachedInputTokens + (payload.usage?.cachedInputTokens ?? 0),
          outputTokens: total.outputTokens + (payload.usage?.outputTokens ?? 0),
          reasoningOutputTokens:
            total.reasoningOutputTokens + (payload.usage?.reasoningOutputTokens ?? 0),
          totalTokens: total.totalTokens + (payload.usage?.totalTokens ?? 0),
        }),
        {
          inputTokens: 0,
          cachedInputTokens: 0,
          outputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 0,
        },
      );
      const usageUnavailable = completeness === "unavailable" || completeness === "invalid";
      return {
        schemaVersion: 1,
        provider: first.provider as ResourceGroupObservationV1["provider"],
        scope: first.payload.scope,
        source: first.payload.source,
        accountingMode: first.payload.accountingMode,
        accountingDescriptorHash: first.payload.accountingDescriptorHash,
        completeness,
        tokenUsage: usageUnavailable ? null : tokenUsage,
        totalTokens: usageUnavailable ? null : tokenUsage.totalTokens,
        runCount: new Set(group.map(({ runId }) => runId)).size,
        reasonCodes: [
          ...new Set([
            ...group.flatMap(({ payload }) => payload.reasonCode ?? []),
            ...(missesMatchingScope ? ["resource_observation_missing"] : []),
          ]),
        ].sort(),
      };
    })
    .sort((left, right) =>
      `${left.provider}\0${left.scope}\0${left.accountingDescriptorHash}`.localeCompare(
        `${right.provider}\0${right.scope}\0${right.accountingDescriptorHash}`,
      ),
    );
}
