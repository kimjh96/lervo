import { createHash } from "node:crypto";

import { validateSchema } from "@lervo/schemas";

import {
  ManagedConversationResponseError,
  type ManagedConversationResponsePlan,
  type ManagedConversationResponseRequest,
  type ManagedConversationResponderOptions,
} from "./types.js";

export function validateConversationResponseRequest(
  options: ManagedConversationResponderOptions,
  input: ManagedConversationResponseRequest,
  plan: ManagedConversationResponsePlan,
): void {
  const presentation = plan.role.outputContract.presentation;
  if (
    input.decision.action !== "respond" ||
    input.event.eventId !== input.decision.eventId ||
    input.event.target.projectId !== options.projectId ||
    input.policy.projectId !== options.projectId ||
    input.decision.projectId !== options.projectId ||
    input.policy.policyId !== input.decision.policyId ||
    input.policy.roleId !== input.decision.roleId ||
    plan.role.roleId !== input.policy.roleId ||
    plan.role.capabilities["filesystem.write"] !== "deny" ||
    plan.role.capabilities["external.message"] !== "deny" ||
    presentation.audience === "machine" ||
    presentation.writingPolicyId !== plan.writingContract.writingPolicyId ||
    plan.writingPolicy.writingPolicyId !== plan.writingContract.writingPolicyId ||
    !plan.writingContract.surfaces.includes("chat") ||
    !validateSchema("role", plan.role).valid ||
    !validateSchema("writingContract", plan.writingContract).valid
  ) {
    throw new ManagedConversationResponseError(
      "invalid_response_request",
      "대화 응답의 프로젝트, 역할, 읽기 전용 실행 또는 writing 정책이 서로 맞지 않습니다.",
    );
  }
}

export function conversationResponseRequestDigest(input: {
  request: ManagedConversationResponseRequest;
  plan: ManagedConversationResponsePlan;
}): string {
  const value = JSON.stringify({
    eventId: input.request.event.eventId,
    policyId: input.request.policy.policyId,
    decisionId: input.request.decision.decisionId,
    roleId: input.plan.role.roleId,
    messageHash: input.request.event.content.contentHash,
  });
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function conversationResponseInstructions(
  input: ManagedConversationResponseRequest,
  message: string,
): string {
  return JSON.stringify({
    task: "conversation_response",
    roleId: input.policy.roleId,
    conversationId: input.event.target.conversationId,
    threadId: input.event.target.threadId,
    participationReason: input.decision.reason,
    requirements: [
      "주입된 공통 맥락과 아래 대화 원문을 바탕으로 답합니다.",
      "읽거나 주입되지 않은 문서를 봤다고 주장하지 않습니다.",
      "외부 플랫폼에는 직접 전송하지 않고 답변 본문만 작성합니다.",
    ],
    message,
  });
}
