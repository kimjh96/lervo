import {
  conversationDeliberationPatterns,
  type ConversationDeliberationSummary,
} from "@lervo/conversation-deliberation-contract";

import { ConversationControlError } from "./types.js";

export * from "@lervo/conversation-deliberation-contract";

export function conversationDeliberationTimestamp(value: string, label: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
    throw new ConversationControlError(
      "deliberation_source_failed",
      `${label} time is invalid.`,
    );
  }
  return milliseconds;
}

export function assertConversationDeliberationSummary(
  summary: ConversationDeliberationSummary,
  deliberationId: string,
): void {
  const action = ({
    running: "wait",
    unknown: "none",
    interrupted: "resume",
    converged: "none",
    no_consensus: "none",
    failed: "none",
  } as const)[summary.status];
  if (
    !conversationDeliberationPatterns.deliberationId.test(summary.deliberationId) ||
    summary.deliberationId !== deliberationId ||
    !Number.isSafeInteger(summary.artifactCount) ||
    summary.artifactCount < 0 || summary.artifactCount > 10_000 ||
    action === undefined || summary.nextAction !== action
  ) {
    throw new ConversationControlError(
      "deliberation_source_failed",
      "The deliberation execution result coordinates do not match the request.",
    );
  }
}
