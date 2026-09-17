import { createHash } from "node:crypto";

import { deliberationPolicyHash } from "@lervo/deliberation";
import { writingContractForLanguage } from "@lervo/core";
import {
  DeliberationRuntime,
  type DeliberationRuntimeSnapshot,
  type DeliberationTurnResult,
} from "@lervo/deliberation-runtime";
import { loadDocumentRegistry } from "@lervo/project";
import type { ProjectStorage } from "@lervo/project-storage";
import { rootWorkId } from "@lervo/execution-contract";
import { loadRepositoryKnowledgePolicy } from "@lervo/repository-knowledge";
import type { WritingContract } from "@lervo/schemas";

import { readApprovedDeliberationCheckpoint } from "./deliberation-checkpoint.js";
import { completeApprovedDeliberation } from "./deliberation-convergence.js";
import { createFailedOutcome } from "./deliberation-contract.js";
import {
  bindAssignedDeliberationParticipants,
  releaseAssignedDeliberationParticipants,
} from "./deliberation-participant-binding.js";
import { loadDeliberationWorkflowSource } from "./deliberation-policy-loader.js";
import { withDeliberationLease } from "./deliberation-lease.js";
import {
  createInlineDeliberationExecutionPlan,
  createStoredDeliberationExecutionPlan,
} from "./deliberation-roles.js";
import { DeliberationWorkspace } from "./deliberation-workspace.js";
import type {
  InlineManagedDeliberationRequest,
  ManagedDeliberationDependencies,
  ManagedDeliberationOutcome,
  ResumeManagedDeliberationRequest,
  StartManagedDeliberationRequest,
  StoredManagedDeliberationRequest,
} from "./managed-deliberation.js";
import { ManagedDeliberationRunner } from "./managed-deliberation-runner.js";
import { prepareManagedDeliberationEvidence } from "./managed-deliberation-evidence.js";

function failureCode(error: unknown): string {
  const value = (error as { code?: unknown } | null)?.code;
  return typeof value === "string" ? value : "deliberation_failed";
}

async function restorePlan(
  request: StartManagedDeliberationRequest,
  storage: ProjectStorage,
  writingContract: WritingContract,
) {
  if (typeof request.policyId === "string") {
    const source = await loadDeliberationWorkflowSource(
      storage.paths.repositoryRoot,
      request.policyId,
    );
    return createStoredDeliberationExecutionPlan({
      projectId: storage.manifest.projectId,
      source,
      writingContract,
    });
  }
  return createInlineDeliberationExecutionPlan({
    projectId: storage.manifest.projectId,
    proposerProvider: request.proposerProvider,
    reviewerProvider: request.reviewerProvider,
    verificationSuiteIds: request.verificationSuiteIds,
    writingContract,
  });
}

async function restoreTurnResult(input: {
  snapshot: DeliberationRuntimeSnapshot;
  artifactId: string;
  storage: ProjectStorage;
}): Promise<DeliberationTurnResult> {
  const artifact = input.snapshot.artifacts.find(
    (item) => item.deliberationArtifactId === input.artifactId,
  );
  const recorded = input.snapshot.recordedEvents.find(
    (item) => item.artifactId === input.artifactId,
  );
  const event = recorded === undefined ? null : input.storage.events.get(recorded.eventId);
  if (artifact === undefined || event?.type !== "deliberation.artifact.recorded") {
    throw new Error(
      "The artifact event in the deliberation resume checkpoint could not be restored.",
    );
  }
  const bytes = await input.storage.artifacts.get(artifact.content.uri);
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (digest !== artifact.content.contentHash || bytes.byteLength !== artifact.content.byteCount) {
    throw new Error(
      "The artifact bytes in the deliberation resume checkpoint do not match their CAS coordinates.",
    );
  }
  const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return { artifact: structuredClone(artifact), content, recordedEvent: event };
}

export async function resumeManagedDeliberationWithStorage(
  request: ResumeManagedDeliberationRequest,
  storage: ProjectStorage,
  dependencies: ManagedDeliberationDependencies,
): Promise<ManagedDeliberationOutcome> {
  const checkpoint = await readApprovedDeliberationCheckpoint({
    stateRoot: storage.paths.state,
    deliberationId: request.resumeDeliberationId,
  });
  const leaseOwnerId = dependencies.createId("dlw");
  return withDeliberationLease({
    stateRoot: storage.paths.state,
    deliberationId: request.resumeDeliberationId,
    ownerId: leaseOwnerId,
    acquiredAt: dependencies.now().toISOString(),
    recoverStale: true,
    work: async () => {
      const originalRequest = {
        repositoryRoot: storage.paths.repositoryRoot,
        ...checkpoint.request,
      } as InlineManagedDeliberationRequest | StoredManagedDeliberationRequest;
      const knowledgePolicy = await loadRepositoryKnowledgePolicy(storage.paths.repositoryRoot);
      const writingContract =
        dependencies.writingContract ??
        writingContractForLanguage(knowledgePolicy.publication.language);
      const policyPlan = await restorePlan(originalRequest, storage, writingContract);
      const plan = bindAssignedDeliberationParticipants({
        storage,
        deliberationId: checkpoint.deliberationId,
        plan: policyPlan,
        boundAt: dependencies.now().toISOString(),
      });
      const policy = plan.policy;
      if (deliberationPolicyHash(policy) !== checkpoint.policyHash) {
        throw new Error("The policy changed after the deliberation resume checkpoint.");
      }
      const checkpointHandoffIds = new Set(
        checkpoint.runtime.handoffs.map((item) => item.handoffId),
      );
      const contextHandoffIds = new Set(
        checkpoint.workspace.contexts.map((item) => item.handoff.handoffId),
      );
      if (
        contextHandoffIds.size !== checkpoint.workspace.contexts.length ||
        contextHandoffIds.size !== checkpointHandoffIds.size ||
        [...checkpointHandoffIds].some((handoffId) => !contextHandoffIds.has(handoffId))
      )
        throw new Error(
          "Workspace handoffs in the deliberation resume checkpoint differ from runtime state.",
        );
      for (const context of checkpoint.workspace.contexts) {
        const runtimePublication = checkpoint.runtime.publications.find(
          (item) => item.publication.sharedContextId === context.publication.sharedContextId,
        );
        const runtimeHandoff = checkpoint.runtime.handoffs.find(
          (item) => item.handoffId === context.handoff.handoffId,
        );
        const handoffEvent =
          runtimeHandoff === undefined ? null : storage.events.get(runtimeHandoff.eventId);
        const participant = plan.participants.find(
          (item) => item.role.roleId === context.producerRole.roleId,
        );
        if (
          runtimePublication === undefined ||
          JSON.stringify(runtimePublication.publication) !== JSON.stringify(context.publication) ||
          handoffEvent?.type !== "handoff.created" ||
          handoffEvent.payload.fromRoleId !== context.handoff.from.roleId ||
          handoffEvent.payload.toRoleId !== context.handoff.toRoleId ||
          JSON.stringify(handoffEvent.payload.sharedContextIds) !==
            JSON.stringify(context.handoff.sharedContextIds) ||
          participant === undefined ||
          JSON.stringify(participant.role) !== JSON.stringify(context.producerRole)
        )
          throw new Error(
            "Published context sources in the deliberation resume checkpoint disagree.",
          );
      }
      const registry = await loadDocumentRegistry(storage.paths.repositoryRoot);
      const recipientRoleIds = plan.participants.map((participant) => participant.role.roleId);
      const workspace = await DeliberationWorkspace.resume({
        repositoryRoot: storage.paths.repositoryRoot,
        stateRoot: storage.paths.state,
        deliberationId: checkpoint.deliberationId,
        registry,
        participantRoleIds: recipientRoleIds,
        snapshot: checkpoint.workspace,
        writingContract,
      });
      if (workspace.taskEvidenceDocumentIds().length === 0) {
        const evidence = await (dependencies.prepareEvidence ?? prepareManagedDeliberationEvidence)(
          {
            repositoryRoot: storage.paths.repositoryRoot,
            topic: originalRequest.topic,
            documentRegistry: registry,
          },
        );
        await workspace.installTaskEvidence(evidence);
      }
      const runtime = new DeliberationRuntime({
        deliberationId: checkpoint.deliberationId,
        policy,
        policyVersion: checkpoint.policyHash,
        coordinates: checkpoint.runtimeCoordinates,
        events: storage.events,
        artifactStore: storage.artifacts,
        participantNames: plan.participants.map((participant) => ({
          roleId: participant.role.roleId,
          name: participant.role.name,
        })),
        now: dependencies.now,
        createEventId: () => dependencies.createId("evt"),
        resumeSnapshot: checkpoint.runtime,
      });
      const runner = new ManagedDeliberationRunner(
        storage,
        workspace,
        checkpoint.policyHash,
        policy.requiredVerificationSuiteIds[0]!,
        {
          ...policy.executionBudget,
          maximumElapsedMs: Math.min(
            policy.executionBudget.maximumElapsedMs,
            originalRequest.executionMaximumElapsedMs ?? policy.executionBudget.maximumElapsedMs,
            request.executionMaximumElapsedMs ?? policy.executionBudget.maximumElapsedMs,
          ),
        },
        dependencies.runner,
        {
          workId: rootWorkId(
            checkpoint.runtimeCoordinates.projectId,
            checkpoint.runtimeCoordinates.runId,
          ),
          runId: checkpoint.runtimeCoordinates.runId,
        },
        request.providerExecutables,
        request.providerModels,
        request.providerReasoningEfforts,
        checkpoint.budgetUsage,
      );
      const latestClaimArtifact = await restoreTurnResult({
        snapshot: checkpoint.runtime,
        artifactId: checkpoint.latestClaimArtifactId,
        storage,
      });
      const approvedReviews = await Promise.all(
        checkpoint.approvedReviewArtifactIds.map((artifactId) =>
          restoreTurnResult({ snapshot: checkpoint.runtime, artifactId, storage }),
        ),
      );
      const claim = latestClaimArtifact.artifact;
      const claimValues =
        claim.kind === "proposal" || claim.kind === "revision" ? claim.details.claims : [];
      const approvedRoleIds = approvedReviews.map((review) => review.artifact.producer.roleId);
      const expectedReviewerRoleIds = plan.reviewers.map((reviewer) => reviewer.role.roleId);
      if (
        !claimValues.some(
          (item) =>
            item.claimId === checkpoint.currentClaim.claimId &&
            item.claimDigest === checkpoint.currentClaim.claimDigest,
        ) ||
        approvedReviews.length !== expectedReviewerRoleIds.length ||
        new Set(approvedRoleIds).size !== expectedReviewerRoleIds.length ||
        expectedReviewerRoleIds.some((roleId) => !approvedRoleIds.includes(roleId)) ||
        approvedReviews.some(
          (review) =>
            review.artifact.kind !== "objection" ||
            review.artifact.round !== claim.round ||
            review.artifact.details.reviewStatus !== "approved" ||
            !review.artifact.previousArtifactIds.includes(claim.deliberationArtifactId),
        )
      )
        throw new Error(
          "The deliberation resume checkpoint does not reference every approval for the latest claim.",
        );
      let result: ManagedDeliberationOutcome;
      try {
        result = await completeApprovedDeliberation({
          request: originalRequest,
          plan,
          deliberationId: checkpoint.deliberationId,
          policy,
          runtime,
          runner,
          workspace,
          proposer: plan.proposer,
          verifier: plan.verifier,
          approvedReviews,
          recipientRoleIds,
          latestClaimArtifact,
          currentClaim: checkpoint.currentClaim,
          now: dependencies.now,
        });
      } catch (error) {
        try {
          const failedOutcome = createFailedOutcome({
            deliberationId: checkpoint.deliberationId,
            policy,
            history: runtime.history(),
            completedAt: dependencies.now().toISOString(),
            unresolvedBlockingObjectionIds: [],
            code: failureCode(error),
          });
          runtime.complete(failedOutcome);
          releaseAssignedDeliberationParticipants({
            storage,
            outcome: failedOutcome,
            releasedAt: dependencies.now().toISOString(),
          });
        } catch {
          // Preserve the original failure instead of presenting incomplete history as completed.
        }
        throw error;
      }
      releaseAssignedDeliberationParticipants({
        storage,
        outcome: result.outcome,
        releasedAt: dependencies.now().toISOString(),
      });
      return result;
    },
  });
}
