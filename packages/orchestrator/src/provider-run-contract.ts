import { ContextPreparationError } from "@roven/context";
import { ContextDeliveryError } from "@roven/context-delivery";
import type {
  AdapterNormalizedEvent,
  AdapterSession,
  AdapterStartRequest,
  AdapterTurn,
} from "@roven/schemas";
import { validateSchema } from "@roven/schemas";

import { TelemetryWriteError } from "./telemetry.js";
import { ManagedContextError } from "./types.js";
import {
  ManagedProviderRunError,
  type ManagedProviderRunFailureCode,
  type ManagedProviderRunInput,
  type ManagedProviderRunOptions,
} from "./provider-run-types.js";

export interface RunFailure {
  error: ManagedProviderRunError;
  phase: string;
  retryable: boolean;
}

export function assertAdapterMessage(value: unknown, label: string): void {
  if (!validateSchema("adapter", value).valid) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      `${label}이 adapter 계약을 통과하지 못했습니다.`,
    );
  }
}

function expectedWritingPolicyId(input: ManagedProviderRunInput): string | null {
  const presentation = input.context.role.outputContract.presentation;
  return presentation.audience === "machine" ? null : presentation.writingPolicyId;
}

export function validateManagedProviderRunInput(
  input: ManagedProviderRunInput,
  coordinates: ManagedProviderRunOptions["coordinates"],
): void {
  if (
    input.instructions.length === 0 ||
    input.risk.length === 0 ||
    input.targetTurnId.length === 0 ||
    input.context.role.roleId !== coordinates.roleId ||
    input.context.role.capabilities["filesystem.write"] !== "deny" ||
    input.context.expectedPaths.length === 0
  ) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "Managed run 요청의 task, 읽기 전용 role 또는 예상 경로가 유효하지 않습니다.",
    );
  }
  const writingPolicyId = expectedWritingPolicyId(input);
  if (
    writingPolicyId !== input.writingPolicy?.writingPolicyId &&
    !(writingPolicyId === null && input.writingPolicy === null)
  ) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "Role의 writing policy와 managed run 입력이 다릅니다.",
    );
  }
}

export function createAdapterStartRequest(input: {
  run: ManagedProviderRunInput;
  options: ManagedProviderRunOptions;
  requestedAt: string;
}): AdapterStartRequest {
  const request: AdapterStartRequest = {
    kind: "start_request",
    schemaVersion: 1,
    adapterId: input.options.adapter.descriptor.adapterId,
    projectId: input.options.coordinates.projectId,
    runId: input.options.coordinates.runId,
    sessionId: input.options.coordinates.sessionId,
    roleId: input.options.coordinates.roleId,
    writingPolicyId: expectedWritingPolicyId(input.run),
    requestDigest: input.run.requestDigest,
    requestedAt: input.requestedAt,
  };
  assertAdapterMessage(request, "Adapter start request");
  return request;
}

export function assertManagedSession(input: {
  request: AdapterStartRequest;
  session: AdapterSession;
  provider: string;
}): void {
  assertAdapterMessage(input.session, "Adapter session");
  if (
    input.session.adapterId !== input.request.adapterId ||
    input.session.projectId !== input.request.projectId ||
    input.session.runId !== input.request.runId ||
    input.session.sessionId !== input.request.sessionId ||
    input.session.roleId !== input.request.roleId ||
    input.session.writingPolicyId !== input.request.writingPolicyId ||
    input.session.provider !== input.provider
  ) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "Adapter session이 managed run 좌표와 다릅니다.",
    );
  }
}

export function assertTerminalTurn(
  turn: AdapterTurn,
  event: AdapterNormalizedEvent,
): void {
  if (
    (event.type !== "provider.turn.completed" && event.type !== "provider.turn.failed") ||
    event.payload.providerTurnId !== turn.providerTurnId
  ) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "Provider terminal signal이 현재 managed turn과 다릅니다.",
    );
  }
}

export function classifyRunFailure(error: unknown, phase: string): RunFailure {
  if (error instanceof ManagedProviderRunError) {
    return {
      error,
      phase,
      retryable:
        error.code === "provider_start_failed" ||
        error.code === "provider_stream_failed" ||
        error.code === "provider_stop_failed",
    };
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
  const code: ManagedProviderRunFailureCode =
    phase === "adapter_start"
      ? "provider_start_failed"
      : phase === "turn_start" || phase === "provider_turn"
        ? "provider_turn_failed"
        : phase === "before_snapshot" || phase === "after_snapshot"
          ? "repository_snapshot_failed"
          : "contract_validation_failed";
  return {
    error: new ManagedProviderRunError(code, "Managed provider run이 실패했습니다.", {
      cause: error,
    }),
    phase,
    retryable: code === "provider_start_failed",
  };
}
