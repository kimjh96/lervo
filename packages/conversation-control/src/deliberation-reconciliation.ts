import {
  assertConversationDeliberationSummary,
  conversationDeliberationPatterns,
  type ConversationDeliberationReconciliationStore,
  type ConversationDeliberationReconciliationTarget,
} from "./deliberation-job.js";
import type { ConversationDeliberationSummary } from "./types.js";
import { ConversationControlError } from "./types.js";

export type ConversationDeliberationReconciliationReason =
  "active_execution" | "history_incomplete" | "source_inconsistent" | "source_not_found";

export interface ConversationDeliberationReconciliationSourcePort {
  inspect(input: {
    job: Readonly<ConversationDeliberationReconciliationTarget>;
    inspectedAt: string;
  }): Promise<
    | {
        status: "confirmed";
        sourceKind: string;
        evidenceHash: string;
        summary: ConversationDeliberationSummary;
      }
    | { status: "not_confirmed"; reason: ConversationDeliberationReconciliationReason }
  >;
}

export type ConversationDeliberationReconciliationResult =
  | { status: "not_found" }
  | { status: "not_uncertain"; summary: ConversationDeliberationSummary }
  | { status: "not_confirmed"; reason: ConversationDeliberationReconciliationReason }
  | { status: "reconciled"; summary: ConversationDeliberationSummary };

export async function reconcileConversationDeliberation(input: {
  store: ConversationDeliberationReconciliationStore;
  source: ConversationDeliberationReconciliationSourcePort;
  projectId: string;
  deliberationId: string;
  now?: () => Date;
}): Promise<ConversationDeliberationReconciliationResult> {
  if (
    !conversationDeliberationPatterns.projectId.test(input.projectId) ||
    !conversationDeliberationPatterns.deliberationId.test(input.deliberationId)
  ) {
    throw new ConversationControlError(
      "deliberation_source_failed",
      "The deliberation queue coordinates to reconcile are invalid.",
    );
  }
  const job = await input.store.inspect({
    projectId: input.projectId,
    deliberationId: input.deliberationId,
  });
  if (job === null) return { status: "not_found" };
  if (job.state !== "uncertain") {
    return {
      status: "not_uncertain",
      summary: job.summary ?? {
        deliberationId: job.deliberationId,
        status: "running",
        artifactCount: 0,
        nextAction: "wait",
      },
    };
  }
  const reconciledAt = (input.now ?? (() => new Date()))().toISOString();
  const inspected = await input.source.inspect({
    job: structuredClone(job),
    inspectedAt: reconciledAt,
  });
  if (inspected.status === "not_confirmed") return inspected;
  if (
    !conversationDeliberationPatterns.reconciliationSourceKind.test(inspected.sourceKind) ||
    !/^sha256:[a-f0-9]{64}$/u.test(inspected.evidenceHash) ||
    inspected.summary.status === "running" ||
    inspected.summary.status === "unknown"
  ) {
    throw new ConversationControlError(
      "deliberation_source_failed",
      "The deliberation reconciliation evidence does not prove a terminal or resumable candidate.",
    );
  }
  assertConversationDeliberationSummary(inspected.summary, job.deliberationId);
  await input.store.reconcile({
    projectId: job.projectId,
    deliberationId: job.deliberationId,
    requestHash: job.requestHash,
    sourceKind: inspected.sourceKind,
    evidenceHash: inspected.evidenceHash,
    reconciledAt,
    summary: inspected.summary,
  });
  return { status: "reconciled", summary: structuredClone(inspected.summary) };
}
