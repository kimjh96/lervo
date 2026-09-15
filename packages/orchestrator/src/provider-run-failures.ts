import { ContextPreparationError } from "@lervo/context";
import { ContextDeliveryError } from "@lervo/context-delivery";

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
  artifact_storage_failed: 95,
  capability_activation_failed: 92,
  provider_stop_failed: 90,
  provider_write_failed: 85,
  unmanaged_change_detected: 80,
  verification_failed: 75,
  approval_required: 72,
  contract_validation_failed: 70,
  repository_snapshot_failed: 60,
  context_injection_failed: 50,
  context_preparation_failed: 50,
  provider_stream_failed: 40,
  provider_turn_failed: 40,
  provider_model_unavailable: 40,
  provider_result_failed: 40,
  provider_start_failed: 40,
  cancelled: 30,
};

function retryable(code: ManagedProviderRunFailureCode): boolean {
  // A provider that never named a model reported capacity, not a rejected request.
  return code === "artifact_storage_failed" || code === "provider_model_unavailable";
}

function failureCodeForPhase(phase: ManagedProviderRunPhase): ManagedProviderRunFailureCode {
  switch (phase) {
    case "adapter_start":
      return "provider_start_failed";
    case "approval_preflight":
      return "approval_required";
    case "capability_activation":
      return "capability_activation_failed";
    case "turn_start":
    case "provider_turn":
      return "provider_turn_failed";
    case "result_collect":
      return "provider_result_failed";
    case "write_bridge":
    case "provider_write":
      return "provider_write_failed";
    case "result_store":
      return "artifact_storage_failed";
    case "project_verification":
      return "verification_failed";
    case "provider_stream":
      return "provider_stream_failed";
    case "adapter_stop":
      return "provider_stop_failed";
    case "before_snapshot":
    case "after_snapshot":
      return "repository_snapshot_failed";
    default:
      return "contract_validation_failed";
  }
}

export function classifyRunFailure(error: unknown, phase: ManagedProviderRunPhase): RunFailure {
  if (error instanceof ManagedProviderRunError) {
    return {
      error,
      phase: error.originPhase ?? phase,
      retryable: retryable(error.code),
    };
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "capability_activation_failed"
  ) {
    return {
      error: new ManagedProviderRunError(
        "capability_activation_failed",
        "The requested provider capabilities could not be activated.",
        { cause: error },
      ),
      phase,
      retryable: false,
    };
  }
  if (error instanceof TelemetryWriteError) {
    return {
      error: new ManagedProviderRunError(
        "telemetry_recording_failed",
        "Failed to record managed run telemetry.",
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
      error: new ManagedProviderRunError(code, "The managed context stage failed.", {
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
        "Failed to prepare managed context.",
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
        "Failed to inject managed context.",
        { cause: error },
      ),
      phase,
      retryable: false,
    };
  }
  if (error instanceof RepositorySnapshotError) {
    return {
      error: new ManagedProviderRunError("repository_snapshot_failed", error.message, {
        cause: error,
      }),
      phase,
      retryable: false,
    };
  }
  const code = failureCodeForPhase(phase);
  return {
    error: new ManagedProviderRunError(code, "The managed provider run failed.", {
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
