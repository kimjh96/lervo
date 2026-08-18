import {
  type AdapterStopRequest,
  type AdapterTurn,
  validateSchema,
} from "@lervo/schemas";

import {
  inspectContextEnvelopeBinding,
  inspectContextReceiptBinding,
} from "./context-binding.js";
import { createManagedWriteDecision } from "./managed-write-binding.js";
import { type AdapterContractFixture, type ProviderAdapter } from "./provider-adapter.js";
import { inspectTurnResultBinding } from "./result-binding.js";

export type AdapterContractViolationCode =
  | "descriptor_invalid"
  | "provider_mismatch"
  | "start_request_invalid"
  | "start_request_mismatch"
  | "session_invalid"
  | "session_mismatch"
  | "context_envelope_invalid"
  | "context_envelope_mismatch"
  | "context_receipt_invalid"
  | "context_receipt_mismatch"
  | "turn_request_invalid"
  | "turn_request_mismatch"
  | "turn_invalid"
  | "turn_mismatch"
  | "turn_result_invalid"
  | "turn_result_mismatch"
  | "normalized_event_invalid"
  | "normalized_event_mismatch"
  | "normalized_event_timeout"
  | "stop_request_invalid"
  | "stop_result_invalid"
  | "stop_result_mismatch";

export interface AdapterContractViolation {
  code: AdapterContractViolationCode;
  detail: string;
}

export interface AdapterContractReport {
  passed: boolean;
  violations: AdapterContractViolation[];
}

function addValidationViolation(
  violations: AdapterContractViolation[],
  code: AdapterContractViolationCode,
  value: unknown,
): void {
  const result = validateSchema("adapter", value);
  if (!result.valid) {
    violations.push({
      code,
      detail: result.errors.map((error) => `${error.instancePath} ${error.message}`).join("; "),
    });
  }
}

function sameCoordinates(
  value: { projectId: string; runId: string; sessionId: string },
  expected: { projectId: string; runId: string; sessionId: string },
): boolean {
  return (
    value.projectId === expected.projectId &&
    value.runId === expected.runId &&
    value.sessionId === expected.sessionId
  );
}

async function nextWithTimeout<T>(
  iterator: AsyncIterator<T>,
  timeoutMs: number,
): Promise<IteratorResult<T> | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      iterator.next(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function evaluateAdapterContract(
  adapter: ProviderAdapter,
  fixture: AdapterContractFixture,
): Promise<AdapterContractReport> {
  const violations: AdapterContractViolation[] = [];
  addValidationViolation(violations, "descriptor_invalid", adapter.descriptor);

  if (adapter.descriptor.provider !== fixture.expectedProvider) {
    violations.push({
      code: "provider_mismatch",
      detail: `expected ${fixture.expectedProvider}, received ${adapter.descriptor.provider}`,
    });
  }
  addValidationViolation(violations, "start_request_invalid", fixture.startRequest);
  if (fixture.startRequest.adapterId !== adapter.descriptor.adapterId) {
    violations.push({
      code: "start_request_mismatch",
      detail: "start request adapterId does not match the descriptor",
    });
  }

  const session = await adapter.start(fixture.startRequest);
  addValidationViolation(violations, "session_invalid", session);
  if (
    !sameCoordinates(session, fixture.startRequest) ||
    session.adapterId !== adapter.descriptor.adapterId ||
    session.provider !== adapter.descriptor.provider ||
    session.roleId !== fixture.startRequest.roleId ||
    session.writingPolicyId !== fixture.startRequest.writingPolicyId ||
    session.executionMode !== fixture.startRequest.executionMode ||
    (session.executionMode === "read_only" &&
      session.effectiveCapabilities.fileChanges === "supported") ||
    (session.executionMode === "managed_write" &&
      session.effectiveCapabilities.fileChanges !== "supported") ||
    Object.entries(session.effectiveCapabilities).some(
      ([capability, support]) =>
        support === "supported" &&
        adapter.descriptor.capabilities[
          capability as keyof typeof adapter.descriptor.capabilities
        ] !== "supported",
    )
  ) {
    violations.push({
      code: "session_mismatch",
      detail: "adapter session changed the managed coordinates or provider identity",
    });
  }
  addValidationViolation(violations, "context_envelope_invalid", fixture.contextEnvelope);
  const envelopeBinding = inspectContextEnvelopeBinding({
    session,
    envelope: fixture.contextEnvelope,
    expectedContextGeneration: fixture.contextEnvelope.contextGeneration,
  });
  if (!envelopeBinding.passed) {
    violations.push({
      code: "context_envelope_mismatch",
      detail: envelopeBinding.violations.map((item) => item.detail).join("; "),
    });
  }

  const receipt = await adapter.injectContext(session, fixture.contextEnvelope);
  addValidationViolation(violations, "context_receipt_invalid", receipt);
  const receiptBinding = inspectContextReceiptBinding({
    session,
    envelope: fixture.contextEnvelope,
    receipt,
    expectedContextGeneration: fixture.contextEnvelope.contextGeneration,
  });
  if (!receiptBinding.passed) {
    violations.push({
      code: "context_receipt_mismatch",
      detail: receiptBinding.violations.map((item) => item.detail).join("; "),
    });
  }

  await adapter.attachManagedWriteBridge(session, {
    authorize: async (request) =>
      createManagedWriteDecision({
        request,
        decision: "deny",
        reasonCode: "capability_denied",
        decidedAt: request.requestedAt,
      }),
    complete: async () => {
      throw new Error("읽기 전용 공통 계약 실행에서 managed write 완료를 보고할 수 없습니다.");
    },
  });

  addValidationViolation(violations, "turn_request_invalid", fixture.turnRequest);
  if (
    !sameCoordinates(fixture.turnRequest, session) ||
    fixture.turnRequest.adapterId !== adapter.descriptor.adapterId ||
    fixture.turnRequest.providerSessionId !== session.providerSessionId ||
    fixture.turnRequest.targetTurnId !== fixture.contextEnvelope.targetTurnId
  ) {
    violations.push({
      code: "turn_request_mismatch",
      detail: "turn request is not bound to the session and injected target turn",
    });
  }
  let acceptedTurn: AdapterTurn | undefined;
  const turn = await adapter.startTurn(session, fixture.turnRequest, (accepted) => {
    if (acceptedTurn !== undefined) {
      violations.push({
        code: "turn_mismatch",
        detail: "adapter accepted the same turn more than once",
      });
      return;
    }
    acceptedTurn = structuredClone(accepted);
  });
  addValidationViolation(violations, "turn_invalid", turn);
  if (
    !sameCoordinates(turn, session) ||
    turn.adapterId !== adapter.descriptor.adapterId ||
    turn.providerSessionId !== session.providerSessionId ||
    turn.targetTurnId !== fixture.turnRequest.targetTurnId
  ) {
    violations.push({
      code: "turn_mismatch",
      detail: "adapter turn changed the managed coordinates or target turn",
    });
  }
  if (acceptedTurn === undefined || JSON.stringify(acceptedTurn) !== JSON.stringify(turn)) {
    violations.push({
      code: "turn_mismatch",
      detail: "adapter did not announce the returned turn before provider execution",
    });
  }

  const expectedEventCount = fixture.expectedEventCount ?? 1;
  const eventTimeoutMs = fixture.eventTimeoutMs ?? 1_000;
  if (!Number.isSafeInteger(expectedEventCount) || expectedEventCount < 1) {
    throw new RangeError("expectedEventCount는 1 이상의 안전한 정수여야 합니다.");
  }
  if (!Number.isSafeInteger(eventTimeoutMs) || eventTimeoutMs < 1) {
    throw new RangeError("eventTimeoutMs는 1 이상의 안전한 정수여야 합니다.");
  }
  const eventAbort = new AbortController();
  const eventIterator = adapter.events(session, eventAbort.signal)[Symbol.asyncIterator]();
  try {
    for (let index = 0; index < expectedEventCount; index += 1) {
      const next = await nextWithTimeout(eventIterator, eventTimeoutMs);
      if (next === null || next.done) {
        violations.push({
          code: "normalized_event_timeout",
          detail: `expected ${expectedEventCount} normalized events, received ${index}`,
        });
        break;
      }
      const event = next.value;
      addValidationViolation(violations, "normalized_event_invalid", event);
      if (!sameCoordinates(event, session) || event.providerSessionId !== session.providerSessionId) {
        violations.push({
          code: "normalized_event_mismatch",
          detail: "normalized event is not bound to the managed adapter session",
        });
      }
    }
  } finally {
    eventAbort.abort();
    const cleanup = eventIterator.return?.();
    if (cleanup !== undefined) {
      const settledCleanup = Promise.resolve(cleanup).catch(() => undefined);
      let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          settledCleanup,
          new Promise<void>((resolve) => {
            cleanupTimer = setTimeout(resolve, Math.min(eventTimeoutMs, 100));
          }),
        ]);
      } finally {
        if (cleanupTimer !== undefined) clearTimeout(cleanupTimer);
      }
    }
  }

  const turnResult = await adapter.getTurnResult(session, turn);
  addValidationViolation(violations, "turn_result_invalid", turnResult);
  const resultBinding = inspectTurnResultBinding({ session, turn, result: turnResult });
  if (!resultBinding.passed || turnResult.content !== fixture.expectedResultContent) {
    violations.push({
      code: "turn_result_mismatch",
      detail: [
        ...resultBinding.violations.map((item) => item.detail),
        ...(turnResult.content === fixture.expectedResultContent
          ? []
          : ["turn result content does not match the fixture"]),
      ].join("; "),
    });
  }

  const stopRequest: AdapterStopRequest = {
    kind: "stop_request",
    schemaVersion: 1,
    adapterId: adapter.descriptor.adapterId,
    projectId: session.projectId,
    runId: session.runId,
    sessionId: session.sessionId,
    providerSessionId: session.providerSessionId,
    reason: fixture.stopReason,
    requestedAt: "2026-08-18T00:00:03Z",
  };
  addValidationViolation(violations, "stop_request_invalid", stopRequest);
  const stopResult = await adapter.stop(session, stopRequest);
  addValidationViolation(violations, "stop_result_invalid", stopResult);
  if (
    !sameCoordinates(stopResult, session) ||
    stopResult.adapterId !== adapter.descriptor.adapterId ||
    stopResult.providerSessionId !== session.providerSessionId ||
    stopResult.status !== stopRequest.reason
  ) {
    violations.push({
      code: "stop_result_mismatch",
      detail: "stop result is not bound to the managed session or requested reason",
    });
  }

  return { passed: violations.length === 0, violations };
}
