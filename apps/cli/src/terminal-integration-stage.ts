import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import {
  applyTerminalIntegrationPlan,
  createTerminalIntegrationPlan,
  inspectTerminalIntegration,
  type TerminalIntegrationPlan,
  type TerminalRuntimeAsset,
  type TerminalIntegrationReceipt,
} from "@lervo/repository-knowledge";
import { openProjectStorage } from "@lervo/project-storage";

import { CommandFailure } from "./command-error-output.js";
import {
  restoreEffectBackup,
  sealEffectBackup,
  takeEffectBackup,
  type EffectBackup,
} from "./effect-backup.js";
import { loadTerminalHookLauncher } from "./terminal-runtime.js";
import { rememberTerminalWorkerEntry } from "./terminal-worker-entry.js";

export interface PreparedTerminalIntegration {
  plan: TerminalIntegrationPlan;
  runtimeContent: string;
  runtimeAssets: TerminalRuntimeAsset[];
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
  const runtimeContent = await loadTerminalHookLauncher();
  const runtimeAssets: TerminalRuntimeAsset[] = [];
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
      runtimeAssets,
    ),
    runtimeContent,
    runtimeAssets,
  };
}

export interface TerminalIntegrationApplication {
  receipt: TerminalIntegrationReceipt;
  /** The backup of the provider hook files, or null when only the generated runtime changed. */
  backupId: string | null;
}

/** Why the applied integration is not current, or null when it verifies. */
export type TerminalIntegrationVerifier = (repositoryRoot: string) => Promise<string | null>;

const verifyTerminalIntegration: TerminalIntegrationVerifier = async (repositoryRoot) => {
  const inspection = await inspectTerminalIntegration(repositoryRoot);
  return inspection.status === "current"
    ? null
    : `the integration is ${inspection.status}${
        inspection.blockers.length === 0
          ? ""
          : ` (${inspection.blockers.map((item) => `${item.provider} ${item.code}`).join(", ")})`
      }`;
};

/**
 * Applies an exact terminal integration plan and records its canonical event (ADR-0561). Provider
 * hook files are backed up first; after the apply the integration must inspect as current, or the
 * backup is restored and the apply fails. Nothing waits for an owner approval.
 */
export async function applyTerminalIntegrationStage(input: {
  repositoryRoot: string;
  prepared: PreparedTerminalIntegration;
  now: Date;
  verify?: TerminalIntegrationVerifier;
}): Promise<TerminalIntegrationApplication> {
  const { plan, runtimeContent, runtimeAssets } = input.prepared;
  const hookPaths = plan.targets
    .filter((target) => target.action === "create" || target.action === "update")
    .map((target) => resolve(plan.repositoryRoot, target.path));
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
    const backup: EffectBackup | null =
      hookPaths.length === 0
        ? null
        : await takeEffectBackup({
            repositoryRoot: input.repositoryRoot,
            effect: "terminal_integration",
            reason: `Terminal integration plan ${plan.planId} updates the provider hook files.`,
            files: hookPaths,
            now: input.now,
          });
    const identity = randomUUID().replaceAll("-", "");
    const receipt = await applyTerminalIntegrationPlan({
      plan,
      runtimeContent,
      runtimeAssets,
      now: input.now,
      recordApplied: (applied) => {
        storage.events.append({
          eventId: `evt_${identity}`,
          projectId: plan.projectId,
          runId: `run_${identity}`,
          sessionId: `ses_${identity}`,
          type: "terminal.integration.applied",
          occurredAt: applied.appliedAt,
          actor: { kind: "system" },
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
    const problem = await (input.verify ?? verifyTerminalIntegration)(input.repositoryRoot);
    if (problem !== null) {
      if (backup !== null)
        await restoreEffectBackup({
          repositoryRoot: input.repositoryRoot,
          backupId: backup.backupId,
        });
      throw new CommandFailure(
        "terminal_integration_verification_failed",
        `The applied terminal integration did not verify: ${problem}. ${
          backup === null
            ? "No provider hook file was changed."
            : "The provider hook files were restored from their backup."
        }`,
        { planId: plan.planId },
      );
    }
    if (backup !== null) await sealEffectBackup(input.repositoryRoot, backup);
    await rememberTerminalWorkerEntry(input.repositoryRoot, process.env.LERVO_CLI_ENTRY);
    return { receipt, backupId: backup?.backupId ?? null };
  } finally {
    await storage.close();
  }
}
