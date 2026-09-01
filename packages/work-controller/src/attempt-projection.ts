import { validateWorkCausalityHistory } from "@lervo/execution-contract";
import {
  validateSchema,
  type EventEnvelope,
  type ResourceUsageRecordedEventPayload,
} from "@lervo/schemas";
import type {
  ManagedAttemptObservationV1,
  ResourceGroupObservationV1,
} from "@lervo/application-contract";

export interface AttemptProjectionV1 {
  attempts: ManagedAttemptObservationV1[];
  resources: ResourceGroupObservationV1[];
}

function terminalState(events: readonly EventEnvelope[]): {
  terminalStatus: ManagedAttemptObservationV1["terminalStatus"];
  verificationStatus: ManagedAttemptObservationV1["verificationStatus"];
} {
  const terminal = events.filter(
    (event) => event.type === "run.completed" || event.type === "run.failed",
  );
  if (terminal.length > 1)
    throw new TypeError("A managed attempt has contradictory terminal events.");
  const event = terminal[0];
  if (event === undefined)
    return { terminalStatus: "in_progress", verificationStatus: "unavailable" };
  if (event.type === "run.failed")
    return { terminalStatus: "failed", verificationStatus: "unavailable" };
  const value = (event.payload as { verificationStatus?: unknown }).verificationStatus;
  return {
    terminalStatus: "completed",
    verificationStatus:
      value === "passed" || value === "failed" || value === "not_run" ? value : "unavailable",
  };
}

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

export function projectManagedAttempts(input: {
  events: readonly EventEnvelope[];
  workstreamId: string;
}): AttemptProjectionV1 {
  const causality = validateWorkCausalityHistory(input.events);
  const attemptRecords = [...causality.values()].filter(
    (record) =>
      record.payload.workstreamId === input.workstreamId &&
      record.payload.assignmentId !== null &&
      (record.payload.relationship === "root" || record.payload.relationship === "retry"),
  );
  const assignmentByWork = new Map<string, string>();
  for (const record of attemptRecords) {
    const assignmentId = record.payload.assignmentId!;
    const existing = assignmentByWork.get(record.payload.workId);
    if (existing !== undefined && existing !== assignmentId) {
      throw new TypeError("A governed work tree crosses assignment authority.");
    }
    assignmentByWork.set(record.payload.workId, assignmentId);
  }
  const attemptKeys = new Set<string>();
  const attempts = attemptRecords
    .map<ManagedAttemptObservationV1>((record) => {
      const key = `${record.payload.assignmentId}\0${record.payload.attemptOrdinal}`;
      if (attemptKeys.has(key))
        throw new TypeError("An assignment has duplicate attempt ordinals.");
      attemptKeys.add(key);
      return {
        schemaVersion: 1,
        assignmentId: record.payload.assignmentId!,
        workId: record.payload.workId,
        runId: record.runId,
        relationship: record.payload.relationship as "root" | "retry",
        attemptOrdinal: record.payload.attemptOrdinal,
        ...terminalState(input.events.filter((event) => event.runId === record.runId)),
      };
    })
    .sort(
      (left, right) =>
        left.assignmentId.localeCompare(right.assignmentId) ||
        left.attemptOrdinal - right.attemptOrdinal,
    );

  const workIds = new Set(attempts.map((attempt) => attempt.workId));
  const attemptRunIds = new Set(attempts.map((attempt) => attempt.runId));
  const runProviders = new Map(
    input.events
      .filter((event) => event.type === "adapter.started" && attemptRunIds.has(event.runId))
      .map((event) => [event.runId, event.actor.provider] as const),
  );
  const observations = input.events
    .filter((event) => event.type === "resource.usage.recorded")
    .map((event) => {
      const validation = validateSchema("resourceUsageRecordedEventPayload", event.payload);
      if (!validation.valid)
        throw new TypeError("A governed work resource observation is invalid.");
      const payload = event.payload as ResourceUsageRecordedEventPayload;
      const provider = event.actor.provider ?? "lervo";
      if (
        payload.source === "provider_reported" &&
        (provider === "lervo" || runProviders.get(event.runId) !== provider)
      ) {
        throw new TypeError("A provider resource observation differs from its run provider.");
      }
      return { runId: event.runId, provider, payload };
    })
    .filter(({ runId, payload }) => attemptRunIds.has(runId) && workIds.has(payload.workId));
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
    const provider = observation.provider;
    const key = [
      provider,
      observation.payload.source,
      observation.payload.accountingMode,
      observation.payload.accountingDescriptorHash,
    ].join("\0");
    const group = groups.get(key) ?? [];
    group.push(observation);
    groups.set(key, group);
  }
  const resources = [...groups.values()]
    .map<ResourceGroupObservationV1>((group) => {
      const first = group[0]!;
      const completeness = resourceCompleteness(group.map(({ payload }) => payload.status));
      const observedTotal = group.reduce(
        (total, { payload }) => total + (payload.usage?.totalTokens ?? 0),
        0,
      );
      return {
        schemaVersion: 1,
        provider: first.provider as "codex" | "claude" | "lervo",
        source: first.payload.source,
        accountingMode: first.payload.accountingMode,
        accountingDescriptorHash: first.payload.accountingDescriptorHash,
        completeness,
        totalTokens:
          completeness === "unavailable" || completeness === "invalid" ? null : observedTotal,
        runCount: new Set(group.map(({ runId }) => runId)).size,
        reasonCodes: [...new Set(group.flatMap(({ payload }) => payload.reasonCode ?? []))].sort(),
      };
    })
    .sort((left, right) =>
      `${left.provider}\0${left.accountingDescriptorHash}`.localeCompare(
        `${right.provider}\0${right.accountingDescriptorHash}`,
      ),
    );
  return { attempts, resources };
}
