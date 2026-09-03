import { randomUUID } from "node:crypto";

import {
  ExecutionStageRecorder,
  executionEnvironmentProfileBytes,
  executionEnvironmentProfileHash,
  type ExecutionStageId,
  type ExecutionStageOutcome,
} from "@lervo/execution-contract";
import type {
  ExecutionEnvironmentProfile,
  ExecutionStagesObservedEventPayload,
} from "@lervo/schemas";

export interface TerminalStageObservationPort {
  measure<T>(stageId: ExecutionStageId, operation: () => Promise<T>): Promise<T>;
  measureChild<T>(
    stageId: ExecutionStageId,
    parentStageId: ExecutionStageId,
    operation: () => Promise<T>,
  ): Promise<T>;
  finalize(
    terminalObservationId: string,
    terminalHook: "UserPromptSubmit" | "Stop",
    outcome: ExecutionStageOutcome,
  ): TerminalStageObservationResult | null;
}

export interface TerminalStageObservationResult {
  profileBytes: Uint8Array;
  profileHash: string;
  payload: ExecutionStagesObservedEventPayload;
}

export interface CreateTerminalStageObservation {
  (lervoBuildDigest: string): TerminalStageObservationPort;
}

export class TerminalStageObservation implements TerminalStageObservationPort {
  private readonly profile: ExecutionEnvironmentProfile;
  private readonly recorder: ExecutionStageRecorder;
  private readonly total: ReturnType<ExecutionStageRecorder["begin"]>;
  private finalized = false;

  constructor(lervoBuildDigest: string, declaredProfile?: ExecutionEnvironmentProfile) {
    this.profile =
      declaredProfile === undefined
        ? {
            kind: "execution_environment_profile",
            schemaVersion: 1,
            profileSource: "runtime_derived",
            lervoBuildDigest,
            adapterId: null,
            adapterVersion: null,
            provider: null,
            operatingSystem: process.platform,
            architecture: process.arch,
            nodeVersion: process.version,
            repositoryProfile: "custom",
            repositoryDocumentCount: null,
            repositoryByteCount: null,
            cacheState: "unknown",
            concurrency: 1,
          }
        : structuredClone(declaredProfile);
    if (this.profile.lervoBuildDigest !== lervoBuildDigest) {
      throw new TypeError("The declared terminal profile does not match the runtime build.");
    }
    this.recorder = new ExecutionStageRecorder({
      clock: process.hrtime.bigint,
      coldState: this.profile.cacheState,
    });
    this.total = this.recorder.begin("total", null);
  }

  measure<T>(stageId: ExecutionStageId, operation: () => Promise<T>): Promise<T> {
    return this.recorder.measure(stageId, "total", operation);
  }

  measureChild<T>(
    stageId: ExecutionStageId,
    parentStageId: ExecutionStageId,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.recorder.measure(stageId, parentStageId, operation);
  }

  finalize(
    terminalObservationId: string,
    terminalHook: "UserPromptSubmit" | "Stop",
    outcome: ExecutionStageOutcome,
  ): TerminalStageObservationResult {
    if (this.finalized) throw new Error("Terminal stage observation was already finalized.");
    this.finalized = true;
    this.recorder.finish(this.total, outcome);
    const profileBytes = executionEnvironmentProfileBytes(this.profile);
    const profileHash = executionEnvironmentProfileHash(this.profile);
    return {
      profileBytes,
      profileHash,
      payload: {
        executionMode: "unmanaged_terminal",
        workId: null,
        terminalObservationId,
        terminalHook,
        observationSetId: `stgobs_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
        stageCatalogVersion: 2,
        environmentProfileDigest: profileHash,
        repositoryProfile: this.profile.repositoryProfile,
        stages: this.recorder.snapshot(),
      },
    };
  }
}

export class DisabledTerminalStageObservation implements TerminalStageObservationPort {
  measure<T>(_stageId: ExecutionStageId, operation: () => Promise<T>): Promise<T> {
    return operation();
  }

  measureChild<T>(
    _stageId: ExecutionStageId,
    _parentStageId: ExecutionStageId,
    operation: () => Promise<T>,
  ): Promise<T> {
    return operation();
  }

  finalize(): null {
    return null;
  }
}

export const createTerminalStageObservation: CreateTerminalStageObservation = (buildDigest) =>
  new TerminalStageObservation(buildDigest);
