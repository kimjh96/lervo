import {
  ResourceUsageAccumulator,
  resourceAccountingDescriptorBytes,
  resourceAccountingDescriptorHash,
} from "@lervo/execution-contract";
import type {
  AdapterDescriptor,
  AdapterNormalizedEvent,
  ResourceAccountingDescriptor,
  ResourceUsageRecordedEventPayload,
  WorkCausalityRecordedEventPayload,
} from "@lervo/schemas";
import type { ContextArtifactPort } from "@lervo/context-delivery";

import { ManagedProviderRunError } from "./provider-run-types.js";
import type { ManagedEventSpec } from "./telemetry.js";
import type { ManagedRunCoordinates } from "./types.js";

function resourceScope(
  relationship: WorkCausalityRecordedEventPayload["relationship"],
): ResourceUsageRecordedEventPayload["scope"] {
  if (relationship === "subagent") return "subagent_provider";
  if (relationship === "publication_evaluation") return "publication_evaluation";
  if (relationship === "deliberation") return "deliberation";
  if (relationship === "improvement_evaluation") return "improvement_evaluation";
  return "primary_provider";
}

export class ManagedResourceObservation {
  private readonly accumulator: ResourceUsageAccumulator;
  private descriptorPersisted = false;

  constructor(
    private readonly descriptor: AdapterDescriptor,
    private readonly accounting: ResourceAccountingDescriptor,
    coordinates: ManagedRunCoordinates,
    causality: WorkCausalityRecordedEventPayload,
  ) {
    this.accumulator = new ResourceUsageAccumulator(accounting, {
      workId: causality.workId,
      runId: coordinates.runId,
      sessionId: coordinates.sessionId,
      providerSessionId: coordinates.sessionId,
      scope: resourceScope(causality.relationship),
    });
  }

  async persistDescriptor(artifacts: ContextArtifactPort): Promise<void> {
    const expectedHash = resourceAccountingDescriptorHash(this.accounting);
    const expectedBytes = resourceAccountingDescriptorBytes(this.accounting);
    try {
      const stored = await artifacts.put(expectedBytes);
      if (stored.contentHash !== expectedHash) {
        throw new Error("Artifact content hash differs from the accounting descriptor hash.");
      }
      const persistedBytes = await artifacts.get(stored.uri);
      if (
        persistedBytes.length !== expectedBytes.length ||
        persistedBytes.some((byte, index) => byte !== expectedBytes[index])
      ) {
        throw new Error("Persisted accounting descriptor bytes differ from their source.");
      }
      this.descriptorPersisted = true;
    } catch (error) {
      throw new ManagedProviderRunError(
        "artifact_storage_failed",
        "Could not persist the provider resource accounting descriptor.",
        { cause: error instanceof Error ? error : undefined },
      );
    }
  }

  observe(event: AdapterNormalizedEvent): void {
    this.accumulator.observe(event);
  }

  event(occurredAt: string): ManagedEventSpec | null {
    if (!this.descriptorPersisted) return null;
    return {
      type: "resource.usage.recorded",
      schemaVersion: 2,
      occurredAt,
      actor: { kind: "provider", provider: this.descriptor.provider },
      payload: this.accumulator.finalize(),
    };
  }
}
