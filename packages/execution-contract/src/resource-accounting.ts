import { createHash } from "node:crypto";

import {
  type AdapterNormalizedEvent,
  type ResourceAccountingDescriptor,
  type ResourceUsage,
  type ResourceUsageRecordedEventPayload,
  type ProviderModelIdentity,
  type WorkCausalityRecordedEventPayload,
  validateSchema,
} from "@lervo/schemas";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function boundedId(prefix: "ruo", value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

export function assertResourceAccountingDescriptor(descriptor: ResourceAccountingDescriptor): void {
  const validation = validateSchema("resourceAccountingDescriptor", descriptor);
  if (!validation.valid) {
    throw new TypeError(
      `Resource accounting descriptor is invalid: ${validation.errors
        .map((item) => `${item.instancePath} ${item.message}`)
        .join("; ")}`,
    );
  }
}

export function resourceAccountingDescriptorBytes(
  descriptor: ResourceAccountingDescriptor,
): Uint8Array {
  assertResourceAccountingDescriptor(descriptor);
  return new TextEncoder().encode(canonicalJson(descriptor));
}

export function resourceAccountingDescriptorHash(descriptor: ResourceAccountingDescriptor): string {
  return sha256(resourceAccountingDescriptorBytes(descriptor));
}

function usageFromEvent(event: AdapterNormalizedEvent): ResourceUsage | null {
  if (event.type !== "provider.usage.updated") return null;
  const payload = event.payload as ResourceUsage & { providerTurnId: string };
  return {
    inputTokens: payload.inputTokens,
    cachedInputTokens: payload.cachedInputTokens,
    outputTokens: payload.outputTokens,
    reasoningOutputTokens: payload.reasoningOutputTokens,
    totalTokens: payload.totalTokens,
    contextWindow: payload.contextWindow === 0 ? null : payload.contextWindow,
  };
}

function usageValid(usage: ResourceUsage): boolean {
  return (
    usage.cachedInputTokens <= usage.inputTokens &&
    usage.reasoningOutputTokens <= usage.outputTokens &&
    usage.totalTokens === usage.inputTokens + usage.outputTokens
  );
}

function usageRegressed(previous: ResourceUsage, next: ResourceUsage): boolean {
  return (
    next.inputTokens < previous.inputTokens ||
    next.cachedInputTokens < previous.cachedInputTokens ||
    next.outputTokens < previous.outputTokens ||
    next.reasoningOutputTokens < previous.reasoningOutputTokens ||
    next.totalTokens < previous.totalTokens
  );
}

function sumUsage(values: readonly ResourceUsage[]): ResourceUsage {
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

export interface ResourceObservationCoordinates {
  workId: string;
  runId: string;
  sessionId: string;
  providerSessionId: string;
  scope: ResourceUsageRecordedEventPayload["scope"];
}

export function resourceScopeForRelationship(
  relationship: WorkCausalityRecordedEventPayload["relationship"],
): ResourceUsageRecordedEventPayload["scope"] {
  if (relationship === "subagent") return "subagent_provider";
  if (relationship === "publication_evaluation") return "publication_evaluation";
  if (relationship === "deliberation") return "deliberation";
  if (relationship === "improvement_evaluation") return "improvement_evaluation";
  return "primary_provider";
}

/** Reduces normalized usage while keeping native provider SDK shapes behind adapters. */
export class ResourceUsageAccumulator {
  private readonly snapshots = new Map<string, ResourceUsage>();
  private readonly deltaDigests = new Map<string, string>();
  private invalidReason: string | null = null;
  private modelIdentity: ProviderModelIdentity;

  constructor(
    private readonly descriptor: ResourceAccountingDescriptor,
    private readonly coordinates: ResourceObservationCoordinates,
  ) {
    assertResourceAccountingDescriptor(descriptor);
    this.modelIdentity = {
      provider: descriptor.provider,
      requestedModel: descriptor.requestedModel,
      answerModel: null,
      observedModelIds: [],
      answerModelEvidence: "unavailable",
      unavailableReason: "provider_model_unavailable",
    };
  }

  observeModelIdentity(identity: ProviderModelIdentity): void {
    if (
      identity.provider !== this.descriptor.provider ||
      identity.requestedModel !== this.descriptor.requestedModel ||
      (identity.answerModel !== null && !identity.observedModelIds.includes(identity.answerModel))
    ) {
      this.invalidReason = "model_identity_mismatch";
      return;
    }
    this.modelIdentity = structuredClone(identity);
  }

  observe(event: AdapterNormalizedEvent): void {
    const usage = usageFromEvent(event);
    if (usage === null || this.invalidReason !== null) return;
    if (!usageValid(usage)) {
      this.invalidReason = "invalid_provider_usage";
      return;
    }
    const providerTurnId = (event.payload as { providerTurnId: string }).providerTurnId;
    const mode = this.descriptor.accountingMode;
    const coordinate =
      mode === "turn_cumulative"
        ? providerTurnId
        : mode === "session_cumulative"
          ? this.coordinates.providerSessionId
          : event.eventId;
    const previous = this.snapshots.get(coordinate);
    if (mode === "operation_delta") {
      const digest = sha256(canonicalJson(usage));
      const known = this.deltaDigests.get(coordinate);
      if (known !== undefined && known !== digest) {
        this.invalidReason = "resource_observation_contradiction";
        return;
      }
      if (known === undefined) {
        this.deltaDigests.set(coordinate, digest);
        this.snapshots.set(coordinate, usage);
      }
      return;
    }
    if (previous !== undefined && usageRegressed(previous, usage)) {
      this.invalidReason = "resource_counter_regressed";
      return;
    }
    this.snapshots.set(coordinate, usage);
  }

  finalize(): ResourceUsageRecordedEventPayload {
    const descriptorHash = resourceAccountingDescriptorHash(this.descriptor);
    const sourceCoordinateDigest = sha256(
      canonicalJson({
        provider: this.descriptor.provider,
        adapterId: this.descriptor.adapterId,
        accountingMode: this.descriptor.accountingMode,
        ...this.coordinates,
      }),
    );
    const base = {
      workId: this.coordinates.workId,
      resourceObservationId: boundedId(
        "ruo",
        `${this.coordinates.workId}:${this.coordinates.runId}:${descriptorHash}`,
      ),
      sourceCoordinateDigest,
      scope: this.coordinates.scope,
      source: "provider_reported" as const,
      accountingMode: this.descriptor.accountingMode,
      accountingDescriptorHash: descriptorHash,
      modelIdentity: structuredClone(this.modelIdentity),
    };
    if (this.invalidReason !== null) {
      return { ...base, status: "invalid", usage: null, reasonCode: this.invalidReason };
    }
    if (this.descriptor.observationSupport === "unavailable") {
      return {
        ...base,
        status: "unavailable",
        usage: null,
        reasonCode: this.descriptor.unavailableReason,
      };
    }
    if (this.snapshots.size === 0) {
      return {
        ...base,
        status: "unavailable",
        usage: null,
        reasonCode: "resource_observation_missing",
      };
    }
    return {
      ...base,
      status: "observed",
      usage: sumUsage([...this.snapshots.values()]),
      reasonCode: null,
    };
  }
}
