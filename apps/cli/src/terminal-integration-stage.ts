import { randomUUID } from "node:crypto";

import {
  applyTerminalIntegrationPlan,
  createTerminalIntegrationPlan,
  type TerminalIntegrationPlan,
  type TerminalIntegrationReceipt,
} from "@lervo/repository-knowledge";
import { openProjectStorage } from "@lervo/project-storage";

import { loadTerminalHookRuntime } from "./terminal-runtime.js";

export interface PreparedTerminalIntegration {
  plan: TerminalIntegrationPlan;
  runtimeContent: string;
}

function latestTerminalIntegrationApplicationEventId(
  storage: Awaited<ReturnType<typeof openProjectStorage>>,
): string | null {
  let afterSeq = 0;
  let latest: string | null = null;
  while (true) {
    const events = storage.events.list({ afterSeq, limit: 1000 });
    if (events.length === 0) return latest;
    for (const event of events) {
      afterSeq = event.seq;
      if (event.type === "terminal.integration.applied") latest = event.eventId;
    }
    if (events.length < 1000) return latest;
  }
}

/** Plans provider hook and generated runtime reconciliation for one repository. */
export async function planTerminalIntegrationStage(
  repositoryRoot: string,
): Promise<PreparedTerminalIntegration> {
  const runtimeContent = await loadTerminalHookRuntime();
  const historyStorage = await openProjectStorage(repositoryRoot);
  let priorApplicationEventId: string | null;
  try {
    priorApplicationEventId = latestTerminalIntegrationApplicationEventId(historyStorage);
  } finally {
    await historyStorage.close();
  }
  return {
    plan: await createTerminalIntegrationPlan(
      repositoryRoot,
      runtimeContent,
      priorApplicationEventId,
    ),
    runtimeContent,
  };
}

/**
 * Applies an exact terminal integration plan and records its canonical event.
 * Provider-owned hook bytes require the displayed approval; generated-only
 * runtime reconciliation accepts none.
 */
export async function applyTerminalIntegrationStage(input: {
  repositoryRoot: string;
  prepared: PreparedTerminalIntegration;
  approval: { operationId: string; approvalHash: string } | null;
  now: Date;
}): Promise<TerminalIntegrationReceipt> {
  const { plan, runtimeContent } = input.prepared;
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    if (latestTerminalIntegrationApplicationEventId(storage) !== plan.priorApplicationEventId)
      throw new Error("Terminal integration application history changed after planning.");
    if (
      storage.events
        .list()
        .some(
          (event) =>
            event.type === "terminal.integration.applied" && event.payload.planId === plan.planId,
        )
    )
      throw new Error("The same terminal integration plan was already applied.");
    const identity = randomUUID().replaceAll("-", "");
    return await applyTerminalIntegrationPlan({
      plan,
      runtimeContent,
      ...(input.approval === null
        ? {}
        : {
            approvedOperationId: input.approval.operationId,
            approvedHash: input.approval.approvalHash,
          }),
      now: input.now,
      recordApplied: (applied) => {
        storage.events.append({
          eventId: `evt_${identity}`,
          projectId: plan.projectId,
          runId: `run_${identity}`,
          sessionId: `ses_${identity}`,
          type: "terminal.integration.applied",
          occurredAt: applied.appliedAt,
          actor: plan.status === "review_required" ? { kind: "user" } : { kind: "system" },
          schemaVersion: 1,
          policyVersion: plan.approvalHash ?? plan.runtime.afterHash,
          payload: {
            operation: applied.operation,
            planId: applied.planId,
            contractId: applied.contractId,
            providers: plan.providers,
            targetPathDigests: applied.targetDigests.map((item) => item.pathDigest),
            targetAfterHashes: applied.targetDigests.map((item) => item.afterHash),
            runtimePathDigest: applied.runtimePathDigest,
            runtimeAfterHash: applied.runtimeAfterHash,
            approvalHash: applied.approvalHash,
            appliedAt: applied.appliedAt,
          },
        });
      },
    });
  } finally {
    await storage.close();
  }
}
