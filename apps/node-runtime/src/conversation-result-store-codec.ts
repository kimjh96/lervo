import { canonicalJson } from "@lervo/event-contract";
import { isRemoteContinuationCoordinate, validateSchema } from "@lervo/schemas";

import type {
  ConversationResultOrigin,
  ConversationResultTerminal,
} from "./conversation-result-types.js";
import { NodeRuntimeError } from "./errors.js";

export function resultTime(value: string, label: string): number {
  const result = Date.parse(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new NodeRuntimeError("startup_failed", `${label} is invalid.`);
  }
  return result;
}

export function parseResultJson<T>(value: string, label: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new NodeRuntimeError("startup_failed", `${label} is corrupted.`, { cause: error });
  }
}

export function assertConversationResultOrigin(origin: ConversationResultOrigin): void {
  const continuation = {
    workstreamId: origin.workstreamId,
    revision: origin.workstreamRevision,
    snapshotContentHash: origin.workstreamSnapshotContentHash,
    assignmentId: origin.assignmentId,
    agentId: origin.agentId,
  };
  if (
    !/^rcd_[a-f0-9]{64}$/u.test(origin.deliveryId) ||
    !/^rcm_[a-f0-9]{64}$/u.test(origin.commandId) ||
    !/^cve_[a-f0-9]{64}$/u.test(origin.sourceEventId) ||
    !/^itg_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(origin.target.integrationId) ||
    !/^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(origin.target.projectId) ||
    !/^cnv_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(origin.target.conversationId) ||
    (origin.target.threadId !== null &&
      !/^thd_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(origin.target.threadId)) ||
    !/^cpp_[a-f0-9]{64}$/u.test(origin.policyId) ||
    !/^ptc_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(origin.agentParticipantId) ||
    !/^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u.test(origin.roleId) ||
    !["codex", "claude"].includes(origin.provider) ||
    !isRemoteContinuationCoordinate(continuation) ||
    !Number.isFinite(Date.parse(origin.queuedAt))
  ) {
    throw new NodeRuntimeError("startup_failed", "Conversation result origin is invalid.");
  }
}

export function assertConversationResultTerminal(terminal: ConversationResultTerminal): void {
  if (
    !validateSchema("remoteCommandDeliveryAcknowledgement", terminal.acknowledgement).valid ||
    terminal.observedAt !== terminal.acknowledgement.acknowledgedAt
  ) {
    throw new NodeRuntimeError("startup_failed", "Conversation result terminal is invalid.");
  }
}

export function sameConversationResultTerminal(
  left: ConversationResultTerminal,
  right: ConversationResultTerminal,
): boolean {
  const comparable = (value: ConversationResultTerminal) => {
    const acknowledgement = value.acknowledgement;
    return acknowledgement.disposition === "completed"
      ? {
          deliveryId: acknowledgement.deliveryId,
          commandId: acknowledgement.commandId,
          commandHash: acknowledgement.commandHash,
          disposition: acknowledgement.disposition,
          receipt: acknowledgement.receipt,
        }
      : {
          deliveryId: acknowledgement.deliveryId,
          commandId: acknowledgement.commandId,
          commandHash: acknowledgement.commandHash,
          disposition: acknowledgement.disposition,
          rejectionCode: acknowledgement.rejectionCode,
        };
  };
  return canonicalJson(comparable(left)) === canonicalJson(comparable(right));
}
