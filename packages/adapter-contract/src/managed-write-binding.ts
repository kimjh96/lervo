import type {
  AdapterManagedWriteCompletion,
  AdapterManagedWriteDecision,
  AdapterManagedWriteRequest,
  AdapterSession,
  AdapterTurn,
} from "@lervo/schemas";

export type ManagedWriteBindingViolationCode =
  | "write_message_invalid"
  | "write_coordinates_mismatch"
  | "write_decision_invalid"
  | "write_request_time_invalid"
  | "write_response_mismatch"
  | "write_response_time_invalid";

export interface ManagedWriteBindingViolation {
  code: ManagedWriteBindingViolationCode;
  detail: string;
}

export interface ManagedWriteBindingReport {
  passed: boolean;
  violations: ManagedWriteBindingViolation[];
}

type ManagedWriteCoordinates = Pick<
  AdapterManagedWriteRequest,
  | "adapterId"
  | "projectId"
  | "runId"
  | "sessionId"
  | "providerSessionId"
  | "targetTurnId"
  | "providerTurnId"
  | "providerItemId"
  | "path"
  | "targetDigest"
  | "changeKind"
>;

function coordinates(request: AdapterManagedWriteRequest): ManagedWriteCoordinates {
  const {
    adapterId,
    projectId,
    runId,
    sessionId,
    providerSessionId,
    targetTurnId,
    providerTurnId,
    providerItemId,
    path,
    targetDigest,
    changeKind,
  } = request;
  return {
    adapterId,
    projectId,
    runId,
    sessionId,
    providerSessionId,
    targetTurnId,
    providerTurnId,
    providerItemId,
    path,
    targetDigest,
    changeKind,
  };
}

function sameCoordinates(
  expected: ManagedWriteCoordinates,
  actual: ManagedWriteCoordinates,
): boolean {
  return Object.keys(expected).every(
    (key) =>
      expected[key as keyof ManagedWriteCoordinates] ===
      actual[key as keyof ManagedWriteCoordinates],
  );
}

export function createManagedWriteRequest(input: {
  session: AdapterSession;
  turn: AdapterTurn;
  providerItemId: string;
  path: string;
  targetDigest: string;
  changeKind: AdapterManagedWriteRequest["changeKind"];
  requestedAt: string;
}): AdapterManagedWriteRequest {
  return {
    kind: "managed_write_request",
    schemaVersion: 1,
    adapterId: input.session.adapterId,
    projectId: input.session.projectId,
    runId: input.session.runId,
    sessionId: input.session.sessionId,
    providerSessionId: input.session.providerSessionId,
    targetTurnId: input.turn.targetTurnId,
    providerTurnId: input.turn.providerTurnId,
    providerItemId: input.providerItemId,
    path: input.path,
    targetDigest: input.targetDigest,
    changeKind: input.changeKind,
    requestedAt: input.requestedAt,
  };
}

export function createManagedWriteDecision(input: {
  request: AdapterManagedWriteRequest;
  decision: AdapterManagedWriteDecision["decision"];
  reasonCode: AdapterManagedWriteDecision["reasonCode"];
  decidedAt: string;
}): AdapterManagedWriteDecision {
  return {
    kind: "managed_write_decision",
    schemaVersion: 1,
    ...coordinates(input.request),
    decision: input.decision,
    reasonCode: input.reasonCode,
    decidedAt: input.decidedAt,
  };
}

export function createManagedWriteCompletion(input: {
  request: AdapterManagedWriteRequest;
  status: AdapterManagedWriteCompletion["status"];
  completedAt: string;
}): AdapterManagedWriteCompletion {
  return {
    kind: "managed_write_completion",
    schemaVersion: 1,
    ...coordinates(input.request),
    status: input.status,
    completedAt: input.completedAt,
  };
}

export function inspectManagedWriteRequestBinding(input: {
  session: AdapterSession;
  turn: AdapterTurn;
  request: AdapterManagedWriteRequest;
}): ManagedWriteBindingReport {
  const violations: ManagedWriteBindingViolation[] = [];
  const requestedAt = Date.parse(input.request.requestedAt);
  const acceptedAt = Date.parse(input.turn.acceptedAt);
  if (
    input.request.adapterId !== input.session.adapterId ||
    input.request.projectId !== input.session.projectId ||
    input.request.runId !== input.session.runId ||
    input.request.sessionId !== input.session.sessionId ||
    input.request.providerSessionId !== input.session.providerSessionId ||
    input.request.targetTurnId !== input.turn.targetTurnId ||
    input.request.providerTurnId !== input.turn.providerTurnId
  ) {
    violations.push({
      code: "write_coordinates_mismatch",
      detail: "The managed write request is not bound to the current session and turn coordinates.",
    });
  }
  if (!Number.isFinite(requestedAt) || !Number.isFinite(acceptedAt) || requestedAt < acceptedAt) {
    violations.push({
      code: "write_request_time_invalid",
      detail: "The managed write request time precedes the turn acceptance time.",
    });
  }
  return { passed: violations.length === 0, violations };
}

export function inspectManagedWriteDecisionBinding(input: {
  request: AdapterManagedWriteRequest;
  decision: AdapterManagedWriteDecision;
}): ManagedWriteBindingReport {
  const violations: ManagedWriteBindingViolation[] = [];
  const decidedAt = Date.parse(input.decision.decidedAt);
  const requestedAt = Date.parse(input.request.requestedAt);
  if (!sameCoordinates(coordinates(input.request), input.decision)) {
    violations.push({
      code: "write_response_mismatch",
      detail: "The managed write decision does not match the request coordinates.",
    });
  }
  if (!Number.isFinite(decidedAt) || !Number.isFinite(requestedAt) || decidedAt < requestedAt) {
    violations.push({
      code: "write_response_time_invalid",
      detail: "The managed write decision time precedes the request time.",
    });
  }
  if (
    (input.decision.decision === "allow" && input.decision.reasonCode !== "authorized") ||
    (input.decision.decision === "deny" && input.decision.reasonCode === "authorized")
  ) {
    violations.push({
      code: "write_decision_invalid",
      detail: "The managed write decision and reason code are inconsistent.",
    });
  }
  return { passed: violations.length === 0, violations };
}

export function inspectManagedWriteCompletionBinding(input: {
  request: AdapterManagedWriteRequest;
  decision: AdapterManagedWriteDecision;
  completion: AdapterManagedWriteCompletion;
}): ManagedWriteBindingReport {
  const violations: ManagedWriteBindingViolation[] = [];
  const completedAt = Date.parse(input.completion.completedAt);
  const decidedAt = Date.parse(input.decision.decidedAt);
  if (!sameCoordinates(coordinates(input.request), input.completion)) {
    violations.push({
      code: "write_response_mismatch",
      detail: "The managed write completion report does not match the request coordinates.",
    });
  }
  if (!Number.isFinite(completedAt) || !Number.isFinite(decidedAt) || completedAt < decidedAt) {
    violations.push({
      code: "write_response_time_invalid",
      detail: "The managed write completion time precedes the approval time.",
    });
  }
  return { passed: violations.length === 0, violations };
}
