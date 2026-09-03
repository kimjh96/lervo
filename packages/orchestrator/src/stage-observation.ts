import { randomUUID } from "node:crypto";

import {
  ExecutionStageRecorder,
  executionEnvironmentProfileBytes,
  executionEnvironmentProfileHash,
  type ExecutionStageId,
  type ExecutionStageOutcome,
  type ExecutionStageToken,
  type MonotonicClock,
} from "@lervo/execution-contract";
import type {
  AdapterDescriptor,
  ExecutionEnvironmentProfile,
  RepositoryPerformanceProfile,
} from "@lervo/schemas";
import type { ContextArtifactPort } from "@lervo/context-delivery";

import { ManagedProviderRunError } from "./provider-run-types.js";
import type { ManagedEventSpec } from "./telemetry.js";

export interface ManagedStageTimingOptions {
  clock?: MonotonicClock;
  repositoryProfile?: RepositoryPerformanceProfile;
  repositoryDocumentCount?: number | null;
  repositoryByteCount?: number | null;
  coldState?: "cold" | "warm" | "unknown";
  concurrency?: number;
}

export class ManagedStageObservation {
  private readonly profile: ExecutionEnvironmentProfile;
  private readonly recorder: ExecutionStageRecorder;
  private readonly total: ExecutionStageToken;
  private profilePersisted = false;

  constructor(input: {
    descriptor: AdapterDescriptor;
    lervoBuildDigest: string;
    timing?: ManagedStageTimingOptions;
  }) {
    const coldState = input.timing?.coldState ?? "unknown";
    this.profile = {
      kind: "execution_environment_profile",
      schemaVersion: 1,
      profileSource: "runtime_derived",
      lervoBuildDigest: input.lervoBuildDigest,
      adapterId: input.descriptor.adapterId,
      adapterVersion: input.descriptor.adapterVersion,
      provider: input.descriptor.provider,
      operatingSystem: process.platform,
      architecture: process.arch,
      nodeVersion: process.version,
      repositoryProfile: input.timing?.repositoryProfile ?? "custom",
      repositoryDocumentCount: input.timing?.repositoryDocumentCount ?? null,
      repositoryByteCount: input.timing?.repositoryByteCount ?? null,
      cacheState: coldState,
      concurrency: input.timing?.concurrency ?? 1,
    };
    this.recorder = new ExecutionStageRecorder({
      clock: input.timing?.clock ?? process.hrtime.bigint,
      coldState,
    });
    this.total = this.recorder.begin("total", null);
  }

  async persistProfile(artifacts: ContextArtifactPort): Promise<void> {
    const expectedHash = executionEnvironmentProfileHash(this.profile);
    const expectedBytes = executionEnvironmentProfileBytes(this.profile);
    try {
      const stored = await artifacts.put(expectedBytes);
      if (stored.contentHash !== expectedHash) {
        throw new Error("Artifact content hash differs from the environment profile hash.");
      }
      const persistedBytes = await artifacts.get(stored.uri);
      if (
        persistedBytes.length !== expectedBytes.length ||
        persistedBytes.some((byte, index) => byte !== expectedBytes[index])
      ) {
        throw new Error("Persisted environment profile bytes differ from their source.");
      }
      this.profilePersisted = true;
    } catch (error) {
      throw new ManagedProviderRunError(
        "artifact_storage_failed",
        "Could not persist the managed execution environment profile.",
        { cause: error instanceof Error ? error : undefined },
      );
    }
  }

  measure<T>(stageId: ExecutionStageId, operation: () => Promise<T>): Promise<T> {
    return this.recorder.measure(stageId, "total", operation);
  }

  event(
    workId: string,
    occurredAt: string,
    outcome: ExecutionStageOutcome,
  ): ManagedEventSpec | null {
    if (!this.profilePersisted) return null;
    this.recorder.finish(this.total, outcome);
    const environmentProfileDigest = executionEnvironmentProfileHash(this.profile);
    return {
      type: "execution.stages.observed",
      schemaVersion: 2,
      occurredAt,
      actor: { kind: "system" },
      payload: {
        executionMode: "managed",
        workId,
        terminalObservationId: null,
        terminalHook: null,
        observationSetId: `stgobs_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
        stageCatalogVersion: 2,
        environmentProfileDigest,
        repositoryProfile: this.profile.repositoryProfile,
        stages: this.recorder.snapshot(),
      },
    };
  }
}
