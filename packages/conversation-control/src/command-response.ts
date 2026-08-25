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
  if (input.options.deliberations === undefined) {
    throw new ConversationControlError(
      "deliberation_source_failed",
      "No deliberation service is connected to this deployment.",
    );
  }
  try {
    const summary =
      input.command.operation === "deliberation_start"
        ? await input.options.deliberations.start({
            event: input.event,
            policyId: input.command.policyId,
            topic: input.command.topic,
            requestedAt: input.at,
          })
        : input.command.operation === "deliberation_resume"
          ? await input.options.deliberations.resume({
              event: input.event,
              deliberationId: input.command.deliberationId,
              requestedAt: input.at,
            })
          : await input.options.deliberations.inspect({
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
    return renderDeliberation(
      summary,
      input.command.operation === "deliberation_start"
        ? "start"
        : input.command.operation === "deliberation_resume"
          ? "resume"
          : null,
    );
  } catch (error) {
    if (error instanceof ConversationControlError) throw error;
    throw new ConversationControlError(
      "deliberation_source_failed",
      "Could not start, resume, or inspect the deliberation.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
}
