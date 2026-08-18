import { createHash } from "node:crypto";

import {
  assertLoadedContextIntegrity,
  type LoadedContext,
} from "@lervo/context";
import { type AdapterSession, validateSchema } from "@lervo/schemas";

import { ContextDeliveryError } from "./types.js";

export function hashBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function validateSession(session: AdapterSession): void {
  const validation = validateSchema("adapter", session);
  if (!validation.valid || session.kind !== "session") {
    throw new ContextDeliveryError(
      "invalid_session",
      "유효한 managed adapter session이 필요합니다.",
      { cause: validation.errors },
    );
  }
}

export function validateLoadedContext(loaded: LoadedContext): void {
  try {
    assertLoadedContextIntegrity(loaded);
  } catch (error) {
    throw new ContextDeliveryError(
      "invalid_loaded_context",
      "E2 LoadedContext 무결성 검증에 실패했습니다.",
      { cause: error },
    );
  }
}

export function assertSessionCoordinates(
  loaded: LoadedContext,
  session: AdapterSession,
): void {
  const coordinates = loaded.plan.coordinates;
  if (
    coordinates.projectId !== session.projectId ||
    coordinates.runId !== session.runId ||
    coordinates.sessionId !== session.sessionId ||
    coordinates.roleId !== session.roleId
  ) {
    throw new ContextDeliveryError(
      "invalid_delivery_request",
      "LoadedContext와 adapter session의 project/run/session/role 좌표가 다릅니다.",
    );
  }
}

export function assertGeneration(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ContextDeliveryError(
      "invalid_delivery_request",
      `${label}은 0 이상의 안전한 정수여야 합니다.`,
    );
  }
}
