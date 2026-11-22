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
import {
  commitKnowledgeEffect,
  gitVisiblePaths,
  type KnowledgeCommitResult,
} from "@lervo/repository-knowledge-runtime";

import { CommandFailure } from "./command-error-output.js";
import {
  effectBackupKeptUntil,
  effectBackupUndoCommand,
  restoreEffectBackup,
  sealEffectBackup,
  takeEffectBackup,
  type EffectBackup,
} from "./effect-backup.js";
import { noticeEffect } from "./effect-notice.js";
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
  /** ADR-0610: the `Lervo Knowledge` commit holding the launcher and hook files. */
  commit: KnowledgeCommitResult;
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
  /** Test seam: interrupts the durable apply at a checkpoint, as a crash would. */
  failureInjector?: Parameters<typeof applyTerminalIntegrationPlan>[0]["failureInjector"];
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
    // ADR-0561: an apply that throws part-way leaves no merged hook file behind.
    const restoreBackup = async () => {
      if (backup !== null)
        await restoreEffectBackup({
          repositoryRoot: input.repositoryRoot,
          backupId: backup.backupId,
        });
    };
    const receipt = await applyTerminalIntegrationPlan({
      plan,
      runtimeContent,
      runtimeAssets,
      now: input.now,
      ...(input.failureInjector === undefined ? {} : { failureInjector: input.failureInjector }),
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
    }).catch(async (error: unknown) => {
      await restoreBackup();
      throw error;
    });
    const problem = await (input.verify ?? verifyTerminalIntegration)(input.repositoryRoot);
    if (problem !== null) {
      await restoreBackup();
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
    if (backup !== null) {
      await sealEffectBackup(input.repositoryRoot, backup);
      await noticeEffect({
        repositoryRoot: input.repositoryRoot,
        effect: "terminal_integration",
        subject: backup.backupId,
        targets: plan.targets
          .filter((target) => target.action === "create" || target.action === "update")
          .map((target) => target.path),
        reason: `merged the Lervo hooks of plan ${plan.planId} into the provider hook files; the backup is kept until ${effectBackupKeptUntil(input.now)}`,
        reviewers: ["post-apply verification"],
        verdict: "verified",
        undo: effectBackupUndoCommand(backup.backupId),
        now: input.now,
      });
    }
    await rememberTerminalWorkerEntry(input.repositoryRoot, process.env.LERVO_CLI_ENTRY);
    // ADR-0610: the upgrade plan held this stage unless it could commit here, so the verified
    // launcher and hook files land as one commit instead of staying in the owner's checkout.
    const committed = await gitVisiblePaths(
      input.repositoryRoot,
      plan.operations.map((operation) => operation.path),
    );
    const commit: KnowledgeCommitResult =
      committed.length === 0
        ? { status: "not_committed", reason: "nothing_to_commit" }
        : await commitKnowledgeEffect({
            repositoryRoot: input.repositoryRoot,
            paths: committed,
            notice: {
              effect: "terminal_integration",
              planId: plan.planId,
              reason: "refreshed the Lervo terminal hook launcher and provider hook files",
              crossCheck: "post-apply verification passed",
            },
          });
    return { receipt, backupId: backup?.backupId ?? null, commit };
  } finally {
    await storage.close();
  }
}
