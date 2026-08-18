import { ContextPreparationError } from "@roven/context";
import { ContextDeliveryError } from "@roven/context-delivery";

import { TelemetryWriteError } from "./telemetry.js";
import { ManagedContextError } from "./types.js";
import { RepositorySnapshotError } from "./repository-snapshot.js";
import type { ManagedProviderRunPhase } from "./provider-run-phase.js";
import {
  ManagedProviderRunError,
  type ManagedProviderRunFailureCode,
} from "./provider-run-types.js";

export interface RunFailure {
  error: ManagedProviderRunError;
  phase: ManagedProviderRunPhase;
  retryable: boolean;
}

const priority: Record<ManagedProviderRunFailureCode, number> = {
  telemetry_recording_failed: 100,
  provider_stop_failed: 90,
  unmanaged_change_detected: 80,
  contract_validation_failed: 70,
  repository_snapshot_failed: 60,
  context_injection_failed: 50,
  context_preparation_failed: 50,
  provider_stream_failed: 40,
  provider_turn_failed: 40,
  provider_start_failed: 40,
  cancelled: 30,
};

function retryable(code: ManagedProviderRunFailureCode): boolean {
  return (
    code === "provider_start_failed" ||
    code === "provider_stream_failed" ||
    code === "provider_stop_failed"
  );
}

export function classifyRunFailure(
  error: unknown,
  phase: ManagedProviderRunPhase,
): RunFailure {
  if (error instanceof ManagedProviderRunError) {
    return { error, phase, retryable: retryable(error.code) };
  }
  if (error instanceof TelemetryWriteError) {
    return {
      error: new ManagedProviderRunError(
        "telemetry_recording_failed",
        "Managed run telemetry 기록에 실패했습니다.",
        { cause: error },
      ),
      phase,
      retryable: false,
    };
  }
  if (error instanceof ManagedContextError) {
    const code =
      error.code === "telemetry_recording_failed"
        ? "telemetry_recording_failed"
        : phase === "context_prepare"
          ? "context_preparation_failed"
          : phase === "context_inject"
            ? "context_injection_failed"
            : "contract_validation_failed";
    return {
      error: new ManagedProviderRunError(code, "Managed context 단계가 실패했습니다.", {
        cause: error,
      }),
      phase,
      retryable: false,
    };
  }
  if (error instanceof ContextPreparationError) {
    return {
      error: new ManagedProviderRunError(
        "context_preparation_failed",
        "Managed context 준비에 실패했습니다.",
        { cause: error },
      ),
      phase,
      retryable: false,
    };
  }
  if (error instanceof ContextDeliveryError) {
    return {
      error: new ManagedProviderRunError(
        "context_injection_failed",
        "Managed context 주입에 실패했습니다.",
        { cause: error },
      ),
      phase,
      retryable: false,
    };
  }
  if (error instanceof RepositorySnapshotError) {
    return {
      error: new ManagedProviderRunError(
        "repository_snapshot_failed",
        error.message,
        { cause: error },
      ),
      phase,
      retryable: false,
    };
  }
  const code: ManagedProviderRunFailureCode =
    phase === "adapter_start"
      ? "provider_start_failed"
      : phase === "turn_start" || phase === "provider_turn"
        ? "provider_turn_failed"
        : phase === "provider_stream"
          ? "provider_stream_failed"
          : phase === "adapter_stop"
            ? "provider_stop_failed"
            : phase === "before_snapshot" || phase === "after_snapshot"
              ? "repository_snapshot_failed"
              : "contract_validation_failed";
  return {
    error: new ManagedProviderRunError(code, "Managed provider run이 실패했습니다.", {
      cause: error,
    }),
    phase,
    retryable: retryable(code),
  };
}

export class RunFailureLedger {
  private readonly failures: RunFailure[] = [];

  add(error: unknown, phase: ManagedProviderRunPhase): RunFailure {
    const failure = classifyRunFailure(error, phase);
    this.failures.push(failure);
    return failure;
  }

  get empty(): boolean {
    return this.failures.length === 0;
  }

  get primary(): RunFailure | undefined {
    return this.failures.reduce<RunFailure | undefined>(
      (selected, candidate) =>
        selected === undefined || priority[candidate.error.code] > priority[selected.error.code]
          ? candidate
          : selected,
      undefined,
    );
  }

  details(): Array<{
    code: ManagedProviderRunFailureCode;
    phase: ManagedProviderRunPhase;
    retryable: boolean;
  }> {
    return this.failures.map((failure) => ({
      code: failure.error.code,
      phase: failure.phase,
      retryable: failure.retryable,
    }));
  }

  resultError(): ManagedProviderRunError | undefined {
    const primary = this.primary;
    if (primary === undefined) return undefined;
    const paths = this.failures.flatMap((failure) => failure.error.paths);
    return new ManagedProviderRunError(primary.error.code, primary.error.message, {
      cause: primary.error.cause,
      paths: [...new Set(paths)].sort(),
      relatedFailures: this.details(),
    });
  }
}
