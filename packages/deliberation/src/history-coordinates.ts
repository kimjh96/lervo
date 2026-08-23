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
  ) historyInvalid("artifact_order_invalid", "The deliberation artifact order, ID, or time is inconsistent.");
  if (state.deliberationId !== null && artifact.deliberationId !== state.deliberationId) {
    historyInvalid("history_coordinate_mismatch", "The deliberation history contains a different deliberation ID.");
  }
  state.deliberationId ??= artifact.deliberationId;
  state.previousRound = artifact.round;
  state.previousTime = createdAt;

  const existingRunRole = state.runRoles.get(artifact.producer.runId);
  if (existingRunRole !== undefined && existingRunRole !== artifact.producer.roleId) {
    historyInvalid("cross_role_run_reuse", "Different roles shared the same managed run.");
  }
  state.runRoles.set(artifact.producer.runId, artifact.producer.roleId);

  const producerSession = artifact.producer.sessionId;
  const existingRole = state.sessionRoles.get(producerSession);
  if (existingRole !== undefined && existingRole !== artifact.producer.roleId) {
    historyInvalid("cross_role_session_reuse", "Different roles shared the same provider session.");
  }
  state.sessionRoles.set(producerSession, artifact.producer.roleId);
  for (const receiptId of [
    ...artifact.inputContext.loadedReceiptIds,
    ...artifact.inputContext.injectedReceiptIds,
  ]) {
    const existingSession = state.receiptSessions.get(receiptId);
    if (existingSession !== undefined && existingSession !== producerSession) {
      historyInvalid("cross_role_receipt_reuse", "Sessions for different roles reused the same context receipt.");
    }
    state.receiptSessions.set(receiptId, producerSession);
  }

  for (const previousId of artifact.previousArtifactIds) {
    const previous = state.artifactsById.get(previousId);
    if (!previous || previous.round > artifact.round) {
      historyInvalid("artifact_order_invalid", "The artifact references a previous artifact that has not yet been finalized.");
    }
  }
}
