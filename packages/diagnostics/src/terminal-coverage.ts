import { validateSchema, type EventEnvelope, type TerminalCoverageReport, type TerminalTurnCoverage } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";

import { DiagnosticsError } from "./types.js";

const TERMINAL_EVENT_TYPES = new Set([
  "terminal.context.prepared",
  "terminal.reference.observed",
  "terminal.turn.observed",
]);

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new DiagnosticsError("terminal_coverage_invalid", "Terminal observation payload is not an object.");
  return value as JsonObject;
}

function string(value: unknown): string {
  if (typeof value !== "string") throw new DiagnosticsError("terminal_coverage_invalid", "Terminal observation coordinate is invalid.");
  return value;
}

function number(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new DiagnosticsError("terminal_coverage_invalid", "Terminal observation count is invalid.");
  return value;
}

function ratio(numerator: number, denominator: number, unavailableReason: string | null = null) {
  if (unavailableReason !== null) return { numerator, denominator, value: null, reason: unavailableReason };
  if (denominator === 0) return { numerator, denominator, value: null, reason: "denominator_unavailable" };
  return { numerator, denominator, value: numerator / denominator, reason: null };
}

function allTerminalEvents(events: EventStore): EventEnvelope[] {
  const collected: EventEnvelope[] = [];
  let afterSeq = 0;
  while (true) {
    const batch = events.list({ afterSeq, limit: 1000 });
    if (batch.length === 0) break;
    for (const event of batch) {
      afterSeq = event.seq;
      if (TERMINAL_EVENT_TYPES.has(event.type)) collected.push(event);
    }
    if (batch.length < 1000) break;
  }
  return collected;
}

function reportForContext(context: EventEnvelope, events: EventEnvelope[]): TerminalTurnCoverage {
  const payload = object(context.payload);
  const loaded = payload.loadedDocuments;
  if (!Array.isArray(loaded) || context.actor.kind !== "provider" || context.actor.provider === undefined) throw new DiagnosticsError("terminal_coverage_invalid", "Terminal context evidence is incomplete.");
  const documents = loaded.map((value) => {
    const item = object(value);
    return {
      conceptId: string(item.conceptId),
      path: string(item.path),
      contentHash: string(item.contentHash),
      scope: string(item.scope) as "full" | "prefix",
      deliveredByteCount: number(item.deliveredByteCount),
      assurance: string(item.assurance) as "unreviewed" | "human_reviewed",
      freshness: string(item.freshness) as "current" | "stale" | "unknown",
    };
  });
  const turns = events.filter((event) => event.type === "terminal.turn.observed" && object(event.payload).contextEventId === context.eventId);
  const turn = turns.at(-1);
  const turnPayload = turn === undefined ? null : object(turn.payload);
  const referencedEventIds = turnPayload === null
    ? new Set<string>()
    : new Set((() => {
        if (!Array.isArray(turnPayload.referenceEventIds)) throw new DiagnosticsError("terminal_coverage_invalid", "Terminal reference coordinates are incomplete.");
        return turnPayload.referenceEventIds.map(string);
      })());
  const references = events.filter((event) => event.type === "terminal.reference.observed" && referencedEventIds.has(event.eventId));
  if (references.some((event) => object(event.payload).contextEventId !== context.eventId || event.runId !== context.runId || event.sessionId !== context.sessionId || event.actor.provider !== context.actor.provider)) {
    throw new DiagnosticsError("terminal_coverage_invalid", "Terminal reference evidence does not match its prepared context.");
  }
  if (turnPayload !== null && (number(turnPayload.referenceCount) !== references.length || references.length !== referencedEventIds.size)) {
    throw new DiagnosticsError("terminal_coverage_invalid", "Terminal reference counts do not match their event coordinates.");
  }
  const referenced = new Set(references.map((event) => {
    const reference = object(event.payload);
    return `${string(reference.conceptId)}\0${string(reference.contentHash)}`;
  }));
  const telemetry = turnPayload === null ? null : string(turnPayload.referenceTelemetry);
  const referenceReason = turn === undefined
    ? "turn_not_observed"
    : telemetry === "unavailable"
      ? "provider_last_message_unavailable"
      : null;
  const referencedCount = documents.filter((document) => referenced.has(`${document.conceptId}\0${document.contentHash}`)).length;
  const recommendationCount = number(payload.recommendationCount);
  return {
    executionMode: "unmanaged",
    runId: context.runId,
    sessionId: context.sessionId,
    provider: context.actor.provider,
    contextEventId: context.eventId,
    occurredAt: context.occurredAt,
    completedAt: turn?.occurredAt ?? null,
    sourceSnapshotId: string(payload.sourceSnapshotId),
    queryDigest: string(payload.queryDigest),
    contextHash: string(payload.contextHash),
    capabilities: {
      hookContextPreparation: "observed",
      providerContextAcceptance: "unsupported",
      explicitOutputReference: turn === undefined || telemetry === "unavailable"
        ? "unavailable"
        : referencedCount === 0 ? "supported_no_observation" : "observed",
      internalUse: "unsupported",
    },
    documents: documents.map((document) => ({
      ...document,
      highestObservation: referenced.has(`${document.conceptId}\0${document.contentHash}`) ? "referenced" : "prepared",
      referenceKinds: referenced.has(`${document.conceptId}\0${document.contentHash}`) ? ["output_citation"] : [],
    })),
    coverage: {
      candidatePreparation: ratio(documents.length, recommendationCount),
      managedDelivery: ratio(0, documents.length, "unmanaged_no_adapter_receipt"),
      explicitReference: ratio(referencedCount, documents.length, referenceReason),
      relevance: ratio(0, 0, "reviewed_ground_truth_unavailable"),
    },
    completion: turnPayload === null ? { result: "not_observed", lifecycleStatus: "not_observed" } : {
      result: string(turnPayload.completionResult) as "allowed" | "blocked",
      lifecycleStatus: string(turnPayload.lifecycleStatus) as "current" | "action_required",
    },
  };
}

export function createTerminalCoverageReport(input: {
  projectId: string;
  events: EventStore;
  provider?: "codex" | "claude";
  limit?: number;
}): TerminalCoverageReport {
  const limit = input.limit ?? 20;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new RangeError("Terminal coverage limit must be between 1 and 100.");
  input.events.verifyIntegrity();
  const events = allTerminalEvents(input.events);
  const contexts = events
    .filter((event) => event.type === "terminal.context.prepared" && (input.provider === undefined || event.actor.provider === input.provider))
    .sort((left, right) => right.seq - left.seq)
    .slice(0, limit);
  const report: TerminalCoverageReport = {
    schemaVersion: 1,
    reportKind: "unmanaged_terminal_context",
    projectId: input.projectId,
    reports: contexts.map((context) => reportForContext(context, events)),
  };
  const validation = validateSchema("terminalCoverageReport", report);
  if (!validation.valid) throw new DiagnosticsError("terminal_coverage_invalid", "Terminal coverage report does not satisfy its versioned contract.");
  return report;
}
