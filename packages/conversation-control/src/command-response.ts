import type { ConversationInboundEvent } from "@lervo/schemas";

import type {
  ConversationControlResponderOptions,
  ConversationDeliberationSummary,
  ParsedConversationControlCommand,
} from "./types.js";
import { ConversationControlError } from "./types.js";

function statusLabel(status: string): string {
  return ({
    pending: "실행 대기",
    leased: "Node 전달 중",
    completed: "실행 완료",
    rejected: "실행 거부",
    expired: "기한 만료",
  } as Record<string, string>)[status] ?? status;
}

function approvalLabel(status: string): string {
  return ({
    unavailable: "정책을 확인할 수 없음",
    denied: "정책에서 거부됨",
    not_required: "별도 승인 불필요",
    approval_required: "승인 필요",
    partially_approved: "일부 범위 승인됨",
    approved: "필요 범위 승인됨",
  } as Record<string, string>)[status] ?? status;
}

function renderHubControl(
  input: Awaited<ReturnType<ConversationControlResponderOptions["control"]["inspect"]>>,
  approvalReview: boolean,
): string {
  const review = input.review;
  const lines = [
    `Command ${review.delivery.commandId}은 현재 ${statusLabel(review.delivery.status)} 상태입니다.`,
    `실행 역할은 ${review.command.roleId}, 공급자는 ${review.command.provider}, 위험도는 ${review.command.risk}입니다. 승인 상태는 ${approvalLabel(review.approval.state)}입니다.`,
  ];
  if (approvalReview) {
    if (input.reviewUrl === null) {
      throw new ConversationControlError("control_source_failed", "승인 검토 주소가 없습니다.");
    }
    lines.push(
      `이 대화에서는 승인이 생성되지 않았습니다. 다음 Hub 화면에서 다시 인증하고 범위를 확인해야 승인할 수 있습니다: ${input.reviewUrl}`,
    );
  } else {
    lines.push("추가 작업이 필요하면 `/lervo approval <delivery-id>` 형식으로 승인 검토 화면을 요청할 수 있습니다.");
  }
  return lines.join("\n\n");
}

function deliberationStatusLabel(status: ConversationDeliberationSummary["status"]): string {
  return ({
    running: "진행 중",
    unknown: "진행 여부 확인 필요",
    interrupted: "재개 대기",
    converged: "결론 도달",
    no_consensus: "합의 없음",
    failed: "실패",
  } as const)[status];
}

function renderDeliberation(summary: ConversationDeliberationSummary, started: boolean): string {
  const lines = [
    started
      ? `숙의 ${summary.deliberationId} 요청을 처리했습니다.`
      : `숙의 ${summary.deliberationId}은 현재 ${deliberationStatusLabel(summary.status)} 상태입니다.`,
    `기록된 산출물은 ${summary.artifactCount}개입니다.`,
  ];
  if (summary.nextAction === "wait") lines.push("현재 작업이 끝날 때까지 기다려 주세요.");
  if (summary.nextAction === "resume") {
    lines.push("재개 권한이 있는 실행 경로에서 승인된 경계부터 이어갈 수 있습니다.");
  }
  return lines.join("\n\n");
}

function assertDeliberationSummary(
  summary: ConversationDeliberationSummary,
  expectedId?: string,
): void {
  const nextActionMatches = summary.status === "running"
    ? summary.nextAction === "wait"
    : summary.status === "interrupted"
      ? summary.nextAction === "resume"
      : summary.nextAction === "none";
  if (
    !/^dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(summary.deliberationId) ||
    (expectedId !== undefined && summary.deliberationId !== expectedId) ||
    !Number.isSafeInteger(summary.artifactCount) || summary.artifactCount < 0 ||
    summary.artifactCount > 10_000 || !nextActionMatches
  ) throw new ConversationControlError(
    "deliberation_source_failed",
    "숙의 서비스가 유효하지 않은 상태를 반환했습니다.",
  );
}

export async function createConversationControlResponse(input: {
  options: ConversationControlResponderOptions;
  event: ConversationInboundEvent;
  command: ParsedConversationControlCommand;
  at: string;
}): Promise<string> {
  if ("deliveryId" in input.command) {
    const controlled = await input.options.control.inspect({
      event: input.event,
      operation: input.command.operation,
      deliveryId: input.command.deliveryId,
      inspectedAt: input.at,
    });
    return renderHubControl(controlled, input.command.operation === "approval_review");
  }
  if (input.options.deliberations === undefined) {
    throw new ConversationControlError(
      "deliberation_source_failed",
      "이 배포에는 숙의 서비스가 연결되지 않았습니다.",
    );
  }
  try {
    const summary = input.command.operation === "deliberation_start"
      ? await input.options.deliberations.start({
          event: input.event,
          policyId: input.command.policyId,
          topic: input.command.topic,
          requestedAt: input.at,
        })
      : await input.options.deliberations.inspect({
          event: input.event,
          deliberationId: input.command.deliberationId,
          inspectedAt: input.at,
        });
    assertDeliberationSummary(
      summary,
      input.command.operation === "deliberation_status"
        ? input.command.deliberationId
        : undefined,
    );
    return renderDeliberation(summary, input.command.operation === "deliberation_start");
  } catch (error) {
    if (error instanceof ConversationControlError) throw error;
    throw new ConversationControlError(
      "deliberation_source_failed",
      "숙의를 시작하거나 상태를 조회하지 못했습니다.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}
