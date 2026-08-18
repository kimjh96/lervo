import { createHash } from "node:crypto";

import type { AdapterSession, AdapterTurn, AdapterTurnResult } from "@roven/schemas";

export const MAX_ADAPTER_TURN_RESULT_BYTES = 4 * 1024 * 1024;

export type TurnResultBindingViolationCode =
  | "result_coordinates_mismatch"
  | "result_content_invalid"
  | "result_content_too_large"
  | "result_hash_mismatch"
  | "result_time_invalid";

export interface TurnResultBindingViolation {
  code: TurnResultBindingViolationCode;
  detail: string;
}

export interface TurnResultBindingReport {
  passed: boolean;
  violations: TurnResultBindingViolation[];
}

export function encodeTurnResultContent(content: string): Uint8Array {
  return Buffer.from(content, "utf8");
}

export function digestTurnResult(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function createAdapterTurnResult(input: {
  session: AdapterSession;
  turn: AdapterTurn;
  content: string;
  producedAt: string;
}): AdapterTurnResult {
  const bytes = encodeTurnResultContent(input.content);
  return {
    kind: "turn_result",
    schemaVersion: 1,
    adapterId: input.session.adapterId,
    projectId: input.session.projectId,
    runId: input.session.runId,
    sessionId: input.session.sessionId,
    providerSessionId: input.session.providerSessionId,
    targetTurnId: input.turn.targetTurnId,
    providerTurnId: input.turn.providerTurnId,
    mediaType: "text/markdown; charset=utf-8",
    content: input.content,
    contentHash: digestTurnResult(bytes),
    byteCount: bytes.byteLength,
    producedAt: input.producedAt,
  };
}

export function inspectTurnResultBinding(input: {
  session: AdapterSession;
  turn: AdapterTurn;
  result: AdapterTurnResult;
}): TurnResultBindingReport {
  const violations: TurnResultBindingViolation[] = [];
  if (
    input.result.adapterId !== input.session.adapterId ||
    input.result.projectId !== input.session.projectId ||
    input.result.runId !== input.session.runId ||
    input.result.sessionId !== input.session.sessionId ||
    input.result.providerSessionId !== input.session.providerSessionId ||
    input.result.targetTurnId !== input.turn.targetTurnId ||
    input.result.providerTurnId !== input.turn.providerTurnId
  ) {
    violations.push({
      code: "result_coordinates_mismatch",
      detail: "Turn result가 managed session과 turn 좌표에 묶이지 않았습니다.",
    });
  }
  const producedAt = Date.parse(input.result.producedAt);
  const acceptedAt = Date.parse(input.turn.acceptedAt);
  if (
    !Number.isFinite(producedAt) ||
    !Number.isFinite(acceptedAt) ||
    producedAt < acceptedAt
  ) {
    violations.push({
      code: "result_time_invalid",
      detail: "Turn result 시각이 turn 수락 시각보다 빠릅니다.",
    });
  }
  const bytes = encodeTurnResultContent(input.result.content);
  if (bytes.byteLength === 0 || Buffer.from(bytes).toString("utf8") !== input.result.content) {
    violations.push({
      code: "result_content_invalid",
      detail: "Turn result를 UTF-8 bytes로 손실 없이 변환할 수 없습니다.",
    });
  }
  if (bytes.byteLength > MAX_ADAPTER_TURN_RESULT_BYTES) {
    violations.push({
      code: "result_content_too_large",
      detail: "Turn result가 provider-neutral 크기 제한을 넘었습니다.",
    });
  }
  if (
    input.result.byteCount !== bytes.byteLength ||
    input.result.contentHash !== digestTurnResult(bytes)
  ) {
    violations.push({
      code: "result_hash_mismatch",
      detail: "Turn result bytes가 선언된 hash 또는 byte count와 다릅니다.",
    });
  }
  return { passed: violations.length === 0, violations };
}
