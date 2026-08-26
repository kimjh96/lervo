import { listAssignments, readWorkspaceIntegrationAttempt } from "@lervo/agent-workforce";
import type { ContextArtifactPort } from "@lervo/context-delivery";
import type { VerificationSuite } from "@lervo/schemas";
import { verificationSuiteHash } from "@lervo/verification-contract";
import { WorkspaceHostError, type WorkspaceIntegrationHostAdapter } from "@lervo/workspace-host";

import type { ManagedProjectVerifier } from "./provider-run-types.js";
import { runRequiredProjectVerifications } from "./project-verification.js";
import {
  captureRepositorySnapshot,
  type CaptureRepositorySnapshot,
} from "./repository-snapshot.js";
import type { ManagedEventSpec } from "./telemetry.js";
import { assertWorkspaceIntegrationPlanBindings } from "./workspace-integration-bindings.js";
import {
  stableWorkspaceIntegrationJson,
  type WorkspaceIntegrationPlan,
  workspaceIntegrationDigest,
} from "./workspace-integration-contract.js";

export interface WorkspaceIntegrationVerificationReceipt {
  schemaVersion: 1;
  attemptId: string;
  targetLeaseId: string;
  planContentHash: string;
  candidateCommit: string;
  candidateTreeHash: string;
  repositoryRevision: string;
  results: Array<{
    suiteId: string;
    suiteHash: string;
    verificationId: string;
    resultArtifactId: string;
    resultContentHash: string;
    completedAt: string;
  }>;
  verifiedAt: string;
  contentHash: string;
}

function targetRequest(plan: WorkspaceIntegrationPlan) {
  return {
    repositoryRoot: plan.repositoryRoot,
    integrationWorkspacePath: plan.integrationWorkspacePath,
    integrationBaseCommit: plan.integrationBaseCommit,
    integrationMarker: plan.integrationMarker,
    targetRef: plan.targetRef,
    targetBeforeCommit: plan.targetBeforeCommit,
  };
}

export async function verifyWorkspaceIntegrationCandidate(input: {
  plan: WorkspaceIntegrationPlan;
  integrationHost: WorkspaceIntegrationHostAdapter;
  suites: readonly VerificationSuite[];
  verifier: ManagedProjectVerifier;
  artifactStore: ContextArtifactPort;
  append: (specs: ManagedEventSpec[]) => void;
  captureSnapshot?: CaptureRepositorySnapshot;
  signal?: AbortSignal;
  now?: () => Date;
}): Promise<WorkspaceIntegrationVerificationReceipt> {
  await assertWorkspaceIntegrationPlanBindings({
    plan: input.plan,
    integrationHost: input.integrationHost,
    ...(input.now === undefined ? {} : { now: input.now() }),
  });
  const [storedAttempt, assignments] = await Promise.all([
    readWorkspaceIntegrationAttempt(input.plan.repositoryRoot, input.plan.attempt.targetLeaseId),
    listAssignments(input.plan.repositoryRoot),
  ]);
  const assignment = assignments.find(
    (item) => item.assignmentId === input.plan.integrationAssignmentId,
  );
  const actualRequirements = input.suites.map((suite) => ({
    suiteId: suite.suiteId,
    suiteHash: verificationSuiteHash(suite),
  }));
  if (
    storedAttempt === null ||
    storedAttempt.attempt.attemptId !== input.plan.attempt.attemptId ||
    storedAttempt.attempt.planContentHash !== input.plan.contentHash ||
    storedAttempt.attempt.state !== "candidate" ||
    storedAttempt.attempt.candidateCommit === null ||
    storedAttempt.attempt.candidateTreeHash === null ||
    assignment === undefined ||
    stableWorkspaceIntegrationJson(assignment.verificationSuiteIds) !==
      stableWorkspaceIntegrationJson(input.suites.map((suite) => suite.suiteId)) ||
    stableWorkspaceIntegrationJson(input.plan.verificationRequirements) !==
      stableWorkspaceIntegrationJson(actualRequirements)
  )
    throw new WorkspaceHostError(
      "host_coordinate_invalid",
      "The integration verification candidate or suite binding is invalid.",
    );
  const candidateCommit = storedAttempt.attempt.candidateCommit;
  const candidateTreeHash = storedAttempt.attempt.candidateTreeHash;
  const inspectedBefore = await input.integrationHost.inspectTarget(targetRequest(input.plan));
  if (
    inspectedBefore.targetCommit !== input.plan.targetBeforeCommit ||
    inspectedBefore.workspace.status !== "present" ||
    inspectedBefore.workspace.headCommit !== candidateCommit ||
    inspectedBefore.workspace.treeHash !== candidateTreeHash ||
    !inspectedBefore.workspace.markerMatched ||
    !inspectedBefore.workspace.clean ||
    inspectedBefore.workspace.gitOperationInProgress !== false
  )
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "The integration candidate changed before verification.",
    );
  const snapshot = input.captureSnapshot ?? captureRepositorySnapshot;
  const before = await snapshot(input.plan.integrationWorkspacePath);
  const clock = input.now ?? (() => new Date());
  const verifications = await runRequiredProjectVerifications({
    suites: input.suites,
    verifier: input.verifier,
    repositoryRoot: input.plan.integrationWorkspacePath,
    repositoryRevision: before.revision,
    artifactStore: input.artifactStore,
    time: () => clock().toISOString(),
    append: input.append,
    failureDisposition: "fail_run",
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  const [after, inspectedAfter] = await Promise.all([
    snapshot(input.plan.integrationWorkspacePath),
    input.integrationHost.inspectTarget(targetRequest(input.plan)),
  ]);
  if (
    after.revision !== before.revision ||
    inspectedAfter.targetCommit !== input.plan.targetBeforeCommit ||
    inspectedAfter.workspace.status !== "present" ||
    inspectedAfter.workspace.headCommit !== candidateCommit ||
    inspectedAfter.workspace.treeHash !== candidateTreeHash ||
    !inspectedAfter.workspace.markerMatched ||
    !inspectedAfter.workspace.clean ||
    inspectedAfter.workspace.gitOperationInProgress !== false
  )
    throw new WorkspaceHostError(
      "host_effect_uncertain",
      "The integration candidate changed during verification.",
    );
  const verifiedAt = clock().toISOString();
  const receipt = {
    schemaVersion: 1 as const,
    attemptId: storedAttempt.attempt.attemptId,
    targetLeaseId: storedAttempt.attempt.targetLeaseId,
    planContentHash: storedAttempt.attempt.planContentHash,
    candidateCommit,
    candidateTreeHash,
    repositoryRevision: before.revision,
    results: verifications.map(({ result, resultArtifact }) => ({
      suiteId: result.suiteId,
      suiteHash: result.suiteHash,
      verificationId: result.verificationId,
      resultArtifactId: resultArtifact.artifactId,
      resultContentHash: resultArtifact.contentHash,
      completedAt: result.completedAt,
    })),
    verifiedAt,
  };
  return { ...receipt, contentHash: workspaceIntegrationDigest(receipt) };
}
