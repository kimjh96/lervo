import type { ConversationInboundEvent } from "@lervo/schemas";

import type {
  ConversationControlResponderOptions,
  ConversationDeliberationSummary,
  ParsedConversationControlCommand,
} from "./types.js";
import { ConversationControlError } from "./types.js";

function statusLabel(status: string): string {
  return (
    (
      {
        pending: "pending execution",
        leased: "being delivered to the node",
        completed: "execution completed",
        rejected: "execution rejected",
        expired: "expired",
      } as Record<string, string>
    )[status] ?? status
  );
}

function approvalLabel(status: string): string {
  return (
    (
      {
        unavailable: "policy unavailable",
        denied: "denied by policy",
        not_required: "no separate approval required",
        approval_required: "approval required",
        partially_approved: "partially approved",
        approved: "required scope approved",
      } as Record<string, string>
    )[status] ?? status
  );
}

function renderHubControl(
  input: Awaited<ReturnType<ConversationControlResponderOptions["control"]["inspect"]>>,
  approvalReview: boolean,
): string {
  const review = input.review;
  const lines = [
    `Command ${review.delivery.commandId} is currently ${statusLabel(review.delivery.status)}.`,
    `The execution role is ${review.command.roleId}, the provider is ${review.command.provider}, and the risk is ${review.command.risk}. Approval is ${approvalLabel(review.approval.state)}.`,
  ];
  if (approvalReview) {
    if (input.reviewUrl === null) {
      throw new ConversationControlError(
        "control_source_failed",
        "The approval review URL is missing.",
      );
    }
    lines.push(
      `No approval was created in this conversation. Reauthenticate and review the scope in the following Hub view before approving: ${input.reviewUrl}`,
    );
  } else {
    lines.push(
      "If further action is needed, request the approval review view with `/lervo approval <delivery-id>`.",
    );
  }
  return lines.join("\n\n");
}

function deliberationStatusLabel(status: ConversationDeliberationSummary["status"]): string {
  return (
    {
      running: "running",
      unknown: "status requires confirmation",
      interrupted: "awaiting resume",
      converged: "converged",
      no_consensus: "no consensus",
      failed: "failed",
    } as const
  )[status];
}

function renderDeliberation(
  summary: ConversationDeliberationSummary,
  request: "start" | "resume" | null,
): string {
  const lines = [
    request === "start"
      ? `Processed deliberation ${summary.deliberationId}.`
      : request === "resume"
        ? `Processed the resume request for deliberation ${summary.deliberationId}.`
        : `Deliberation ${summary.deliberationId} is currently ${deliberationStatusLabel(summary.status)}.`,
    `${summary.artifactCount} artifacts are recorded.`,
  ];
  if (summary.nextAction === "wait") lines.push("Wait for the current work to finish.");
  if (summary.nextAction === "resume") {
    lines.push(
      "Continue from the approved boundary through an execution path authorized to resume.",
    );
  }
  return lines.join("\n\n");
}

function renderDeliberationProductAcknowledgement(
  summary: ConversationDeliberationSummary,
  request: "start" | "resume" | null,
  responseLanguage: "en" | "ko",
): string {
  if (request === "start" && summary.status === "running") {
    return responseLanguage === "ko"
      ? "이해관계자별 독립 검토를 시작했습니다. 검증된 결론이나 해결되지 않은 쟁점을 준비되는 대로 이 대화에 답글로 전달하겠습니다."
      : "I started an independent stakeholder review. I’ll return the verified decision or unresolved points to this conversation when it is ready.";
  }
  if (request === "resume") {
    return responseLanguage === "ko"
      ? "검증된 체크포인트부터 검토를 재개했습니다. 결과가 준비되면 이 대화에 답글로 전달하겠습니다."
      : "I resumed the review from its verified checkpoint. I’ll return the result to this conversation when it is ready.";
  }
  return renderDeliberation(summary, request);
}

function assertDeliberationSummary(
  summary: ConversationDeliberationSummary,
  expectedId?: string,
): void {
  const nextActionMatches =
    summary.status === "running"
      ? summary.nextAction === "wait"
      : summary.status === "interrupted"
        ? summary.nextAction === "resume"
        : summary.nextAction === "none";
  if (
    !/^dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(summary.deliberationId) ||
    (expectedId !== undefined && summary.deliberationId !== expectedId) ||
    !Number.isSafeInteger(summary.artifactCount) ||
    summary.artifactCount < 0 ||
    summary.artifactCount > 10_000 ||
    !nextActionMatches
  )
    throw new ConversationControlError(
      "deliberation_source_failed",
      "The deliberation service returned an invalid state.",
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
  return createConversationDeliberationResponse({
    deliberations: input.options.deliberations,
    event: input.event,
    command: input.command,
    at: input.at,
  });
}

export async function createConversationDeliberationResponse(input: {
  deliberations: ConversationControlResponderOptions["deliberations"];
  event: ConversationInboundEvent;
  command: Exclude<ParsedConversationControlCommand, { deliveryId: string }>;
  at: string;
  presentation?: "diagnostic" | "product";
  responseLanguage?: "en" | "ko";
}): Promise<string> {
  if (input.deliberations === undefined) {
    throw new ConversationControlError(
      "deliberation_source_failed",
      "No deliberation service is connected to this deployment.",
    );
  }
  try {
    const summary =
      input.command.operation === "deliberation_start"
        ? await input.deliberations.start({
            event: input.event,
            policyId: input.command.policyId,
            topic: input.command.topic,
            requestedAt: input.at,
          })
        : input.command.operation === "deliberation_resume"
          ? await input.deliberations.resume({
              event: input.event,
              deliberationId: input.command.deliberationId,
              requestedAt: input.at,
            })
          : await input.deliberations.inspect({
              event: input.event,
              deliberationId: input.command.deliberationId,
              inspectedAt: input.at,
            });
    assertDeliberationSummary(
      summary,
      input.command.operation === "deliberation_status" ||
        input.command.operation === "deliberation_resume"
        ? input.command.deliberationId
        : undefined,
    );
    const request =
      input.command.operation === "deliberation_start"
        ? "start"
        : input.command.operation === "deliberation_resume"
          ? "resume"
          : null;
    return input.presentation === "product"
      ? renderDeliberationProductAcknowledgement(summary, request, input.responseLanguage ?? "en")
      : renderDeliberation(summary, request);
  } catch (error) {
    if (error instanceof ConversationControlError) throw error;
    throw new ConversationControlError(
      "deliberation_source_failed",
      "Could not start, resume, or inspect the deliberation.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}
