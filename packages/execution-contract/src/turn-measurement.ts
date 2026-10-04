import { createHash } from "node:crypto";

import {
  validateSchema,
  type ResourceAccountingDescriptor,
  type ResourceUsage,
  type ResourceUsageAttribution,
  type ResourceUsageRecordedEventPayload,
} from "@lervo/schemas";

import {
  resourceAccountingDescriptorBytes,
  resourceAccountingDescriptorHash,
} from "./resource-accounting.js";

/**
 * ADR-0459 measurement for provider turns that do not run through the managed coordinator:
 * one context receipt (selected and loaded documents) and one attributed usage record per turn.
 * Neither record claims injection or use; those states need adapter receipts and later evidence.
 */
export type TurnUsageObservation =
  | {
      status: "observed";
      source: "provider_reported" | "lervo_measured" | "estimated";
      usage: ResourceUsage;
    }
  | { status: "unavailable"; reasonCode: string };

export interface TurnUsageSource {
  provider: "codex" | "claude";
  adapterId: string;
  adapterVersion: string;
  /** Names the native counter semantics the adapter normalized, never the native payload. */
  nativeCounterSemanticsId: string;
  requestedModel: string | null;
  providerSessionId: string;
}

export interface TurnContextDocument {
  documentId: string;
  contentHash: string;
  byteCount: number;
  ruleId: string;
}

export interface TurnMeasurementInput {
  coordinates: { projectId: string; runId: string; sessionId: string };
  attribution: ResourceUsageAttribution;
  source: TurnUsageSource;
  usage: TurnUsageObservation;
  context: { sourceRevision: string; documents: readonly TurnContextDocument[] };
  occurredAt: string;
}

export interface TurnMeasurementEventSpec {
  eventId: string;
  projectId: string;
  runId: string;
  sessionId: string;
  type: "context.selected" | "document.loaded" | "resource.usage.recorded";
  schemaVersion: 2;
  policyVersion: string;
  occurredAt: string;
  actor: { kind: "system" } | { kind: "provider"; provider: "codex" | "claude" };
  payload: Record<string, unknown>;
}

export interface TurnMeasurement {
  descriptor: ResourceAccountingDescriptor;
  descriptorBytes: Uint8Array;
  events: TurnMeasurementEventSpec[];
}

export class TurnMeasurementError extends Error {
  readonly code = "measurement_unavailable";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "TurnMeasurementError";
  }
}

const TURN_MEASUREMENT_NORMALIZATION_ID = "lervo.turn-measurement.v1";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

const TURN_MEASUREMENT_POLICY_VERSION = `sha256:${digest(TURN_MEASUREMENT_NORMALIZATION_ID)}`;

function measurementEventId(turnEventId: string, label: string): string {
  return `evt_${digest(`lervo.turn-measurement.v1\0${turnEventId}\0${label}`).slice(0, 32)}`;
}

function usageValid(usage: ResourceUsage): boolean {
  return (
    usage.cachedInputTokens <= usage.inputTokens &&
    usage.reasoningOutputTokens <= usage.outputTokens &&
    usage.totalTokens === usage.inputTokens + usage.outputTokens
  );
}

/** Derives one stable work identity per measured turn so retries never double-count usage. */
export function turnMeasurementWorkId(turnEventId: string): string {
  return `wrk_${digest(`lervo.turn-measurement.work.v1\0${turnEventId}`).slice(0, 24)}`;
}

export function turnUsagePayload(input: {
  attribution: ResourceUsageAttribution;
  source: TurnUsageSource;
  usage: TurnUsageObservation;
  descriptorHash: string;
}): ResourceUsageRecordedEventPayload {
  const workId = turnMeasurementWorkId(input.attribution.turnEventId);
  const base = {
    workId,
    resourceObservationId: `ruo_${digest(`${workId}\0${input.descriptorHash}`).slice(0, 24)}`,
    sourceCoordinateDigest: `sha256:${digest(
      [
        input.source.provider,
        input.source.adapterId,
        input.source.providerSessionId,
        input.attribution.turnEventId,
      ].join("\0"),
    )}`,
    scope: "primary_provider" as const,
    accountingMode: "turn_cumulative" as const,
    accountingDescriptorHash: input.descriptorHash,
    modelIdentity: {
      provider: input.source.provider,
      requestedModel: input.source.requestedModel,
      answerModel: null,
      observedModelIds: [],
      answerModelEvidence: "unavailable" as const,
      unavailableReason: "provider_model_unavailable",
    },
    agentId: input.attribution.agentId,
    conversationDigest: input.attribution.conversationDigest,
    channel: input.attribution.channel,
    turnEventId: input.attribution.turnEventId,
    stage: input.attribution.stage,
  };
  if (input.usage.status === "unavailable") {
    return {
      ...base,
      source: "provider_reported",
      status: "unavailable",
      usage: null,
      reasonCode: input.usage.reasonCode,
    };
  }
  if (!usageValid(input.usage.usage)) {
    return {
      ...base,
      source: input.usage.source,
      status: "invalid",
      usage: null,
      reasonCode: "invalid_provider_usage",
    };
  }
  return {
    ...base,
    source: input.usage.source,
    status: "observed",
    usage: structuredClone(input.usage.usage),
    reasonCode: null,
  };
}

/**
 * Builds the receipt and usage events for one turn. An invalid record is a measurement failure:
 * callers must fail the turn's completion gate rather than publish an unmeasured result.
 */
export function createTurnMeasurement(input: TurnMeasurementInput): TurnMeasurement {
  const descriptorBase = {
    kind: "resource_accounting_descriptor" as const,
    schemaVersion: 2 as const,
    provider: input.source.provider,
    adapterId: input.source.adapterId,
    adapterVersion: input.source.adapterVersion,
    accountingMode: "turn_cumulative" as const,
    normalizationId: TURN_MEASUREMENT_NORMALIZATION_ID,
    nativeCounterSemanticsId: input.source.nativeCounterSemanticsId,
    requestedModel: input.source.requestedModel,
    serviceTier: null,
  };
  const descriptor: ResourceAccountingDescriptor =
    input.usage.status === "unavailable"
      ? {
          ...descriptorBase,
          observationSupport: "unavailable",
          unavailableReason: input.usage.reasonCode,
        }
      : { ...descriptorBase, observationSupport: "supported", unavailableReason: null };
  let descriptorBytes: Uint8Array;
  try {
    descriptorBytes = resourceAccountingDescriptorBytes(descriptor);
  } catch (error) {
    throw new TurnMeasurementError("The turn usage accounting descriptor is invalid.", {
      cause: error,
    });
  }
  const payload = turnUsagePayload({
    attribution: input.attribution,
    source: input.source,
    usage: input.usage,
    descriptorHash: resourceAccountingDescriptorHash(descriptor),
  });
  if (!validateSchema("resourceUsageRecordedEventPayload", payload).valid) {
    throw new TurnMeasurementError("The attributed turn usage record is invalid.");
  }
  const documentIds = new Set<string>();
  for (const document of input.context.documents) {
    if (documentIds.has(document.documentId)) {
      throw new TurnMeasurementError("The turn context receipt repeats a document.");
    }
    documentIds.add(document.documentId);
  }
  const envelope = {
    ...input.coordinates,
    schemaVersion: 2 as const,
    policyVersion: TURN_MEASUREMENT_POLICY_VERSION,
    occurredAt: input.occurredAt,
  };
  const turnEventId = input.attribution.turnEventId;
  const receipt = input.context.documents.flatMap((document): TurnMeasurementEventSpec[] => [
    {
      ...envelope,
      eventId: measurementEventId(turnEventId, `selected\0${document.documentId}`),
      type: "context.selected",
      actor: { kind: "system" },
      payload: {
        documentId: document.documentId,
        reasonCode: "search_recommendation",
        ruleId: document.ruleId,
        required: false,
        scope: { kind: "full" },
        origin: "managed_turn",
      },
    },
    {
      ...envelope,
      eventId: measurementEventId(turnEventId, `loaded\0${document.documentId}`),
      type: "document.loaded",
      actor: { kind: "system" },
      payload: {
        evidenceReceiptId: `ctx_${digest(`${turnEventId}\0loaded\0${document.documentId}`).slice(0, 24)}`,
        documentId: document.documentId,
        contentHash: document.contentHash,
        byteCount: document.byteCount,
        scope: { kind: "full" },
        sourceRevision: input.context.sourceRevision,
      },
    },
  ]);
  return {
    descriptor,
    descriptorBytes,
    events: [
      ...receipt,
      {
        ...envelope,
        eventId: measurementEventId(turnEventId, "usage"),
        type: "resource.usage.recorded",
        actor: { kind: "provider", provider: input.source.provider },
        payload: payload as unknown as Record<string, unknown>,
      },
    ],
  };
}

/** The storage surface measurement needs; structural so this contract stays storage-neutral. */
export interface TurnMeasurementStorage {
  artifacts: { put(content: Uint8Array): Promise<{ contentHash: string }> };
  events: {
    get(eventId: string): unknown;
    transact<T>(work: (transaction: { append(draft: never): unknown }) => T): T;
  };
}

/**
 * Persists the accounting descriptor and appends the turn's records atomically. Records already
 * present from an interrupted attempt are kept, so a retried turn never double-counts usage.
 */
export async function recordTurnMeasurement(
  storage: TurnMeasurementStorage,
  measurement: TurnMeasurement,
): Promise<void> {
  try {
    const stored = await storage.artifacts.put(measurement.descriptorBytes);
    if (stored.contentHash !== resourceAccountingDescriptorHash(measurement.descriptor)) {
      throw new Error("The stored accounting descriptor differs from its hash.");
    }
    storage.events.transact((transaction) => {
      for (const event of measurement.events) {
        if (storage.events.get(event.eventId) !== null) continue;
        transaction.append(event as never);
      }
    });
  } catch (error) {
    if (error instanceof TurnMeasurementError) throw error;
    throw new TurnMeasurementError("The turn measurement records could not be stored.", {
      cause: error,
    });
  }
}
