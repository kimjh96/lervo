import type {
  AdapterCapabilityMatrix,
  AdapterNormalizedEvent,
  AdapterSession,
  AdapterStartRequest,
  AdapterStopRequest,
  AdapterStopResult,
  AdapterTurn,
} from "@roven/schemas";
import { validateSchema } from "@roven/schemas";

import {
  ManagedProviderRunError,
  type ManagedProviderRunInput,
  type ManagedProviderRunOptions,
} from "./provider-run-types.js";

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
    input.context.role.capabilities["filesystem.write"] === "require_approval" ||
    input.context.expectedPaths.length === 0
  ) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "Managed run 요청의 task, 파일 쓰기 정책 또는 예상 경로가 유효하지 않습니다.",
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
    executionMode:
      input.run.context.role.capabilities["filesystem.write"] === "allow"
        ? "managed_write"
        : "read_only",
    requestedAt: input.requestedAt,
  };
  assertAdapterMessage(request, "Adapter start request");
  return request;
}

export function assertManagedSession(input: {
  request: AdapterStartRequest;
  session: AdapterSession;
  provider: string;
  descriptorCapabilities: AdapterCapabilityMatrix;
}): void {
  assertAdapterMessage(input.session, "Adapter session");
  if (
    input.session.adapterId !== input.request.adapterId ||
    input.session.projectId !== input.request.projectId ||
    input.session.runId !== input.request.runId ||
    input.session.sessionId !== input.request.sessionId ||
    input.session.roleId !== input.request.roleId ||
    input.session.writingPolicyId !== input.request.writingPolicyId ||
    input.session.executionMode !== input.request.executionMode ||
    (input.session.executionMode === "read_only" &&
      input.session.effectiveCapabilities.fileChanges === "supported") ||
    (input.session.executionMode === "managed_write" &&
      input.session.effectiveCapabilities.fileChanges !== "supported") ||
    Object.entries(input.session.effectiveCapabilities).some(
      ([capability, support]) =>
        support === "supported" &&
        input.descriptorCapabilities[capability as keyof AdapterCapabilityMatrix] !== "supported",
    ) ||
    input.session.provider !== input.provider
  ) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "Adapter session이 managed run 좌표 또는 실행 모드와 다릅니다.",
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

export function assertManagedTurn(input: {
  request: import("@roven/schemas").AdapterTurnRequest;
  session: AdapterSession;
  turn: AdapterTurn;
}): void {
  assertAdapterMessage(input.turn, "Adapter turn");
  if (
    input.turn.adapterId !== input.session.adapterId ||
    input.turn.projectId !== input.session.projectId ||
    input.turn.runId !== input.session.runId ||
    input.turn.sessionId !== input.session.sessionId ||
    input.turn.providerSessionId !== input.session.providerSessionId ||
    input.turn.targetTurnId !== input.request.targetTurnId
  ) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "Adapter turn이 managed session 또는 target turn 좌표와 다릅니다.",
    );
  }
}

export function assertManagedStopResult(input: {
  request: AdapterStopRequest;
  result: AdapterStopResult;
}): void {
  assertAdapterMessage(input.result, "Adapter stop result");
  if (
    input.result.adapterId !== input.request.adapterId ||
    input.result.projectId !== input.request.projectId ||
    input.result.runId !== input.request.runId ||
    input.result.sessionId !== input.request.sessionId ||
    input.result.providerSessionId !== input.request.providerSessionId ||
    input.result.status !== input.request.reason
  ) {
    throw new ManagedProviderRunError(
      "contract_validation_failed",
      "Adapter stop result가 managed session 좌표와 다릅니다.",
    );
  }
}
