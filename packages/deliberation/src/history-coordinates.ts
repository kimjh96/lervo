import type { DeliberationArtifact } from "@lervo/schemas";

import type { DeliberationHistoryState } from "./history-state.js";
import { DeliberationError, type DeliberationErrorReason } from "./types.js";

function historyInvalid(reason: DeliberationErrorReason, message: string): never {
  throw new DeliberationError("history_contract_invalid", reason, message);
}

export function validateHistoryCoordinates(
  state: DeliberationHistoryState,
  artifact: DeliberationArtifact,
): void {
  const createdAt = Date.parse(artifact.createdAt);
  if (
    state.artifactsById.has(artifact.deliberationArtifactId) ||
    artifact.round < state.previousRound || createdAt < state.previousTime
  ) historyInvalid("artifact_order_invalid", "숙의 artifact 순서, ID 또는 시각이 일관되지 않습니다.");
  if (state.deliberationId !== null && artifact.deliberationId !== state.deliberationId) {
    historyInvalid("history_coordinate_mismatch", "숙의 이력에 다른 deliberation ID가 섞였습니다.");
  }
  state.deliberationId ??= artifact.deliberationId;
  state.previousRound = artifact.round;
  state.previousTime = createdAt;

  const existingRunRole = state.runRoles.get(artifact.producer.runId);
  if (existingRunRole !== undefined && existingRunRole !== artifact.producer.roleId) {
    historyInvalid("cross_role_run_reuse", "서로 다른 역할이 같은 managed run을 공유했습니다.");
  }
  state.runRoles.set(artifact.producer.runId, artifact.producer.roleId);

  const producerSession = artifact.producer.sessionId;
  const existingRole = state.sessionRoles.get(producerSession);
  if (existingRole !== undefined && existingRole !== artifact.producer.roleId) {
    historyInvalid("cross_role_session_reuse", "서로 다른 역할이 같은 provider session을 공유했습니다.");
  }
  state.sessionRoles.set(producerSession, artifact.producer.roleId);
  for (const receiptId of [
    ...artifact.inputContext.loadedReceiptIds,
    ...artifact.inputContext.injectedReceiptIds,
  ]) {
    const existingSession = state.receiptSessions.get(receiptId);
    if (existingSession !== undefined && existingSession !== producerSession) {
      historyInvalid("cross_role_receipt_reuse", "서로 다른 역할 session이 같은 context receipt를 재사용했습니다.");
    }
    state.receiptSessions.set(receiptId, producerSession);
  }

  for (const previousId of artifact.previousArtifactIds) {
    const previous = state.artifactsById.get(previousId);
    if (!previous || previous.round > artifact.round) {
      historyInvalid("artifact_order_invalid", "아직 확정되지 않은 이전 artifact를 참조합니다.");
    }
  }
}
