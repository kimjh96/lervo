import {
  beginWorkspaceIntegrationAdvancement,
  commitWorkspaceIntegrationAttempt,
  hasExactWorkspaceIntegrationRecordedEvent,
  readWorkspaceIntegrationAttempt,
  rollbackWorkspaceIntegrationAdvancement,
  type WorkspaceIntegrationAttempt,
  type WorkspaceIntegrationVerificationCoordinate,
} from "@lervo/agent-workforce";
import { WorkspaceHostError, type WorkspaceIntegrationHostAdapter } from "@lervo/workspace-host";

import { assertWorkspaceIntegrationPlanBindings } from "./workspace-integration-bindings.js";
import {
  stableWorkspaceIntegrationJson,
  type WorkspaceIntegrationPlan,
  workspaceIntegrationDigest,
} from "./workspace-integration-contract.js";
import { finalizeIntegrationSuccessSources } from "./workspace-integration-source-state.js";
import type { WorkspaceIntegrationVerificationReceipt } from "./workspace-integration-verify.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;

export interface WorkspaceIntegrationCompletionReceipt {
  schemaVersion: 1;
  status: "integrated";
  attemptId: string;
  targetLeaseId: string;
  targetBeforeCommit: string;
  targetAfterCommit: string;
  verificationReceiptHash: string;
  integratedWorkspaceIds: string[];
  recordedAt: string;
  contentHash: string;
}

function targetRequest(plan: WorkspaceIntegrationPlan, candidate: WorkspaceIntegrationAttempt) {
  if (candidate.candidateCommit === null || candidate.candidateTreeHash === null)
    throw new WorkspaceHostError(
      "host_coordinate_invalid",
      "The integration attempt has no exact candidate.",
    );
  return {
    repositoryRoot: plan.repositoryRoot,
    integrationWorkspacePath: plan.integrationWorkspacePath,
    integrationBaseCommit: plan.integrationBaseCommit,
    integrationMarker: plan.integrationMarker,
    targetRef: plan.targetRef,
    targetBeforeCommit: plan.targetBeforeCommit,
    candidateCommit: candidate.candidateCommit,
    candidateTreeHash: candidate.candidateTreeHash,
    idempotencyKey: plan.advanceIdempotencyKey,
  };
}

function verificationCoordinates(
  receipt: WorkspaceIntegrationVerificationReceipt,
): WorkspaceIntegrationVerificationCoordinate[] {
  return receipt.results.map(
    ({ suiteId, suiteHash, verificationId, resultArtifactId, resultContentHash }) => ({
      suiteId,
      suiteHash,
      verificationId,
      resultArtifactId,
      resultContentHash,
    }),
  );
}

function assertVerificationReceipt(
  plan: WorkspaceIntegrationPlan,
  receipt: WorkspaceIntegrationVerificationReceipt,
): void {
  const { contentHash, ...content } = receipt;
  const actualRequirements = receipt.results.map(({ suiteId, suiteHash }) => ({
    suiteId,
    suiteHash,
  }));
  if (
    receipt.schemaVersion !== 1 ||
    !HASH.test(contentHash) ||
    workspaceIntegrationDigest(content) !== contentHash ||
    receipt.attemptId !== plan.attempt.attemptId ||
    receipt.targetLeaseId !== plan.attempt.targetLeaseId ||
    receipt.planContentHash !== plan.contentHash ||
    stableWorkspaceIntegrationJson(actualRequirements) !==
      stableWorkspaceIntegrationJson(plan.verificationRequirements) ||
    receipt.results.some(
      (result) =>
        !/^ver_[A-Za-z0-9_-]{8,128}$/u.test(result.verificationId) ||
        !/^art_[A-Za-z0-9_-]{8,128}$/u.test(result.resultArtifactId) ||
        !HASH.test(result.resultContentHash) ||
        !Number.isFinite(Date.parse(result.completedAt)),
    ) ||
    !Number.isFinite(Date.parse(receipt.verifiedAt))
  )
    throw new WorkspaceHostError(
      "host_coordinate_invalid",
      "The integration verification receipt is invalid or stale.",
    );
}

function exactAdvancementBinding(
  attempt: WorkspaceIntegrationAttempt,
  receipt: WorkspaceIntegrationVerificationReceipt,
): boolean {
  return (
    attempt.candidateCommit === receipt.candidateCommit &&
    attempt.candidateTreeHash === receipt.candidateTreeHash &&
    attempt.verificationReceiptHash === receipt.contentHash &&
    stableWorkspaceIntegrationJson(attempt.verificationResults) ===
      stableWorkspaceIntegrationJson(verificationCoordinates(receipt)) &&
    attempt.targetAfterCommit === receipt.candidateCommit
  );
}

async function assertHostCandidate(input: {
  plan: WorkspaceIntegrationPlan;
  attempt: WorkspaceIntegrationAttempt;
  integrationHost: WorkspaceIntegrationHostAdapter;
}): Promise<"before" | "after"> {
  const inspected = await input.integrationHost.inspectTarget(input.plan);
  if (
    input.attempt.candidateCommit === null ||
    input.attempt.candidateTreeHash === null ||
    inspected.workspace.status !== "present" ||
    inspected.workspace.headCommit !== input.attempt.candidateCommit ||
    inspected.workspace.treeHash !== input.attempt.candidateTreeHash ||
    !inspected.workspace.markerMatched ||
    !inspected.workspace.clean ||
    inspected.workspace.gitOperationInProgress !== false ||
    ![input.plan.targetBeforeCommit, input.attempt.candidateCommit].includes(
      inspected.targetCommit ?? "",
    )
  )
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "The verified integration candidate or target ref changed before completion.",
    );
  return inspected.targetCommit === input.plan.targetBeforeCommit ? "before" : "after";
}

async function advanceExactTarget(input: {
  plan: WorkspaceIntegrationPlan;
  attempt: WorkspaceIntegrationAttempt;
  integrationHost: WorkspaceIntegrationHostAdapter;
}): Promise<void> {
  if ((await assertHostCandidate(input)) === "after") return;
  try {
    await input.integrationHost.advanceTarget(targetRequest(input.plan, input.attempt));
  } catch (error) {
    if ((await assertHostCandidate(input)) !== "after") throw error;
  }
}

async function rollbackUncommittedTarget(input: {
  plan: WorkspaceIntegrationPlan;
  attempt: WorkspaceIntegrationAttempt;
  contentHash: string;
  integrationHost: WorkspaceIntegrationHostAdapter;
  occurredAt: string;
}): Promise<void> {
  const rolledBack = await input.integrationHost.rollbackTarget(
    targetRequest(input.plan, input.attempt),
  );
  if (!rolledBack)
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "The uncommitted integration target could not be rolled back exactly.",
    );
  await rollbackWorkspaceIntegrationAdvancement({
    repositoryRoot: input.plan.repositoryRoot,
    targetLeaseId: input.attempt.targetLeaseId,
    expectedContentHash: input.contentHash,
    expectedRevision: input.attempt.revision,
    eventId: input.plan.rollbackEventId,
    occurredAt: input.occurredAt,
  });
}

function completionReceipt(
  attempt: WorkspaceIntegrationAttempt,
): WorkspaceIntegrationCompletionReceipt {
  if (
    attempt.state !== "integrated" ||
    attempt.targetAfterCommit === null ||
    attempt.verificationReceiptHash === null
  )
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "The integration success record is incomplete.",
    );
  const content = {
    schemaVersion: 1 as const,
    status: "integrated" as const,
    attemptId: attempt.attemptId,
    targetLeaseId: attempt.targetLeaseId,
    targetBeforeCommit: attempt.targetBeforeCommit,
    targetAfterCommit: attempt.targetAfterCommit,
    verificationReceiptHash: attempt.verificationReceiptHash,
    integratedWorkspaceIds: attempt.sources.map((source) => source.workspaceId),
    recordedAt: attempt.updatedAt,
  };
  return { ...content, contentHash: workspaceIntegrationDigest(content) };
}

export async function completeWorkspaceIntegration(input: {
  plan: WorkspaceIntegrationPlan;
  verificationReceipt: WorkspaceIntegrationVerificationReceipt;
  integrationHost: WorkspaceIntegrationHostAdapter;
  now?: Date;
}): Promise<WorkspaceIntegrationCompletionReceipt> {
  if (input.integrationHost.capabilities.targetAdvance !== true)
    throw new WorkspaceHostError(
      "host_coordinate_invalid",
      "The integration host cannot advance an exact target ref.",
    );
  await assertWorkspaceIntegrationPlanBindings({
    plan: input.plan,
    integrationHost: input.integrationHost,
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  assertVerificationReceipt(input.plan, input.verificationReceipt);
  const occurredAt = (input.now ?? new Date()).toISOString();
  let stored = await readWorkspaceIntegrationAttempt(
    input.plan.repositoryRoot,
    input.plan.attempt.targetLeaseId,
  );
  if (
    stored === null ||
    stored.attempt.attemptId !== input.plan.attempt.attemptId ||
    stored.attempt.planContentHash !== input.plan.contentHash ||
    stored.attempt.candidateCommit !== input.verificationReceipt.candidateCommit ||
    stored.attempt.candidateTreeHash !== input.verificationReceipt.candidateTreeHash ||
    !["candidate", "advancing", "integrated"].includes(stored.attempt.state)
  )
    throw new WorkspaceHostError(
      "host_coordinate_invalid",
      "The verified integration attempt is absent or changed.",
    );
  if (stored.attempt.state === "candidate")
    stored = await beginWorkspaceIntegrationAdvancement({
      repositoryRoot: input.plan.repositoryRoot,
      targetLeaseId: stored.attempt.targetLeaseId,
      expectedContentHash: stored.contentHash,
      expectedRevision: stored.attempt.revision,
      eventId: input.plan.advancingEventId,
      occurredAt,
      verificationReceiptHash: input.verificationReceipt.contentHash,
      verificationResults: verificationCoordinates(input.verificationReceipt),
    });
  if (!exactAdvancementBinding(stored.attempt, input.verificationReceipt))
    throw new WorkspaceHostError(
      "host_coordinate_invalid",
      "The integration attempt is bound to different verification evidence.",
    );
  await advanceExactTarget({
    plan: input.plan,
    attempt: stored.attempt,
    integrationHost: input.integrationHost,
  });
  if (stored.attempt.state === "advancing") {
    try {
      stored = await commitWorkspaceIntegrationAttempt({
        repositoryRoot: input.plan.repositoryRoot,
        targetLeaseId: stored.attempt.targetLeaseId,
        expectedContentHash: stored.contentHash,
        expectedRevision: stored.attempt.revision,
        eventId: input.plan.integratedAttemptEventId,
        occurredAt,
      });
    } catch (error) {
      const current = await readWorkspaceIntegrationAttempt(
        input.plan.repositoryRoot,
        input.plan.attempt.targetLeaseId,
      );
      if (
        current !== null &&
        current.attempt.state === "integrated" &&
        (await hasExactWorkspaceIntegrationRecordedEvent({
          repositoryRoot: input.plan.repositoryRoot,
          eventId: input.plan.integratedAttemptEventId,
          attempt: current.attempt,
        }))
      )
        stored = current;
      else {
        await rollbackUncommittedTarget({
          plan: input.plan,
          attempt: stored.attempt,
          contentHash: stored.contentHash,
          integrationHost: input.integrationHost,
          occurredAt,
        });
        throw error;
      }
    }
  }
  if (
    stored.attempt.state !== "integrated" ||
    !(await hasExactWorkspaceIntegrationRecordedEvent({
      repositoryRoot: input.plan.repositoryRoot,
      eventId: input.plan.integratedAttemptEventId,
      attempt: stored.attempt,
    }))
  )
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "The exact integration success event is absent.",
    );
  await finalizeIntegrationSuccessSources(input.plan, occurredAt);
  if ((await assertHostCandidate({ ...input, attempt: stored.attempt })) !== "after")
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "The integration target did not retain the recorded candidate.",
    );
  return completionReceipt(stored.attempt);
}
