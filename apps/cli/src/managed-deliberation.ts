import { randomUUID } from "node:crypto";

import { writingContractForLanguage } from "@lervo/core";
import { rootWorkId } from "@lervo/execution-contract";
import { deliberationPolicyHash } from "@lervo/deliberation";
import {
  DeliberationRuntime,
  type DeliberationRuntimeCoordinates,
} from "@lervo/deliberation-runtime";
import { loadDocumentRegistry } from "@lervo/project";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { loadRepositoryKnowledgePolicy } from "@lervo/repository-knowledge";
import type {
  DeliberationOutcome,
  DeliberationResponsibility,
  WritingContract,
} from "@lervo/schemas";

import { completeApprovedDeliberation } from "./deliberation-convergence.js";
import {
  writeApprovedDeliberationCheckpoint,
  type ApprovedDeliberationCheckpoint,
} from "./deliberation-checkpoint.js";
import { createFailedOutcome } from "./deliberation-contract.js";
import { executeDeliberationRounds } from "./deliberation-rounds.js";
import { loadDeliberationWorkflowSource } from "./deliberation-policy-loader.js";
import { acquireDeliberationLease, releaseDeliberationLease } from "./deliberation-lease.js";
import { resumeManagedDeliberationWithStorage } from "./managed-deliberation-resume.js";
import {
  createInlineDeliberationExecutionPlan,
  createStoredDeliberationExecutionPlan,
  type DeliberationExecutionPlan,
} from "./deliberation-roles.js";
import { DeliberationWorkspace } from "./deliberation-workspace.js";
import {
  ManagedDeliberationRunner,
  type ManagedDeliberationRunnerDependencies,
} from "./managed-deliberation-runner.js";
import { ManagedDeliberationError } from "./managed-deliberation-errors.js";
import { executeManagedDeliberationLifecycle } from "./managed-deliberation-lifecycle.js";
import type { RunProvider } from "./managed-run.js";

export { ManagedDeliberationError } from "./managed-deliberation-errors.js";

interface ManagedDeliberationRequestBase {
  repositoryRoot: string;
  topic: string;
}

export interface InlineManagedDeliberationRequest extends ManagedDeliberationRequestBase {
  proposerProvider: RunProvider;
  reviewerProvider: RunProvider;
  verificationSuiteIds: readonly string[];
  policyId?: never;
}

export interface StoredManagedDeliberationRequest extends ManagedDeliberationRequestBase {
  policyId: string;
  proposerProvider?: never;
  reviewerProvider?: never;
  verificationSuiteIds?: never;
}

export interface ResumeManagedDeliberationRequest {
  repositoryRoot: string;
  resumeDeliberationId: string;
  topic?: never;
  policyId?: never;
  proposerProvider?: never;
  reviewerProvider?: never;
  verificationSuiteIds?: never;
}

export type ManagedDeliberationRequest =
  | InlineManagedDeliberationRequest
  | StoredManagedDeliberationRequest
  | ResumeManagedDeliberationRequest;

export type StartManagedDeliberationRequest =
  InlineManagedDeliberationRequest | StoredManagedDeliberationRequest;

export interface ManagedDeliberationOutcome {
  deliberationId: string;
  status: "converged" | "no_consensus";
  outcome: DeliberationOutcome;
  artifactCount: number;
  finalContent: string;
  providers: {
    proposer: RunProvider;
    reviewer: RunProvider;
  };
  participants: Array<{
    roleId: string;
    name: string;
    provider: RunProvider;
    responsibilities: DeliberationResponsibility[];
  }>;
}

export type ExecuteManagedDeliberation = (
  request: ManagedDeliberationRequest,
) => Promise<ManagedDeliberationOutcome>;

export interface AssignedManagedDeliberationRequest {
  deliberationId: string;
  expectedProjectId: string;
  request: ManagedDeliberationRequest;
}

export type ExecuteAssignedManagedDeliberation = (
  assignment: AssignedManagedDeliberationRequest,
) => Promise<ManagedDeliberationOutcome>;

export interface ManagedDeliberationDependencies {
  openStorage(root: string): Promise<ProjectStorage>;
  createId(prefix: string): string;
  now(): Date;
  writingContract?: WritingContract;
  runner?: ManagedDeliberationRunnerDependencies;
  afterApprovedCheckpoint?(deliberationId: string): Promise<void> | void;
}

const defaultDependencies: ManagedDeliberationDependencies = {
  openStorage: openProjectStorage,
  createId: (prefix) => `${prefix}_${randomUUID().replaceAll("-", "")}`,
  now: () => new Date(),
};

export class DeliberationProcessInterruptedError extends Error {
  constructor(message = "The deliberation process was interrupted after the approved checkpoint.") {
    super(message);
    this.name = "DeliberationProcessInterruptedError";
  }
}

function validSuites(suites: readonly string[]): boolean {
  return (
    suites.length > 0 &&
    suites.length <= 16 &&
    new Set(suites).size === suites.length &&
    suites.every(
      (suiteId) => suiteId.length <= 150 && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(suiteId),
    )
  );
}

function assertRequest(request: ManagedDeliberationRequest): void {
  if ("resumeDeliberationId" in request) {
    if (!/^dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(request.resumeDeliberationId)) {
      throw new ManagedDeliberationError(
        "deliberation_request_invalid",
        "The deliberation ID to resume is invalid.",
      );
    }
    return;
  }
  const topicIsValid = request.topic.trim().length > 0 && request.topic.length <= 20_000;
  const stored = typeof request.policyId === "string";
  const inlineValid =
    !stored &&
    request.proposerProvider !== request.reviewerProvider &&
    validSuites(request.verificationSuiteIds);
  if (!topicIsValid || (!stored && !inlineValid)) {
    throw new ManagedDeliberationError(
      "deliberation_request_invalid",
      "A valid topic and either a stored policy or distinct Codex and Claude roles with a verification suite are required.",
    );
  }
}

function errorCode(error: unknown): string {
  const value = (error as { code?: unknown } | null)?.code;
  return typeof value === "string" ? value : "deliberation_failed";
}

async function resolveExecutionPlan(
  request: StartManagedDeliberationRequest,
  storage: ProjectStorage,
  writingContract: WritingContract,
): Promise<DeliberationExecutionPlan> {
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

async function resolveWritingContract(
  repositoryRoot: string,
  override: WritingContract | undefined,
): Promise<WritingContract> {
  if (override !== undefined) return structuredClone(override);
  const knowledgePolicy = await loadRepositoryKnowledgePolicy(repositoryRoot);
  return writingContractForLanguage(knowledgePolicy.publication.language);
}

export function createManagedDeliberationExecutor(
  dependencies: ManagedDeliberationDependencies = defaultDependencies,
): ExecuteManagedDeliberation {
  return async (request) => {
    assertRequest(request);
    return executeManagedDeliberationLifecycle({
      request,
      dependencies,
      executeWithStorage,
    });
  };
}

export function createAssignedManagedDeliberationExecutor(
  dependencies: ManagedDeliberationDependencies = defaultDependencies,
): ExecuteAssignedManagedDeliberation {
  return async (assignment) => {
    if (
      !/^dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(assignment.deliberationId) ||
      !/^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(assignment.expectedProjectId)
    ) {
      throw new ManagedDeliberationError(
        "deliberation_request_invalid",
        "The assigned deliberation ID is invalid.",
      );
    }
    assertRequest(assignment.request);
    if (
      "resumeDeliberationId" in assignment.request &&
      assignment.request.resumeDeliberationId !== assignment.deliberationId
    ) {
      throw new ManagedDeliberationError(
        "deliberation_request_invalid",
        "The assigned deliberation ID differs from the deliberation ID to resume.",
      );
    }
    return executeManagedDeliberationLifecycle({
      request: assignment.request,
      dependencies,
      ...("resumeDeliberationId" in assignment.request
        ? {}
        : { assignedDeliberationId: assignment.deliberationId }),
      expectedProjectId: assignment.expectedProjectId,
      executeWithStorage,
    });
  };
}

async function executeWithStorage(
  request: ManagedDeliberationRequest,
  storage: ProjectStorage,
  dependencies: ManagedDeliberationDependencies,
  assignedDeliberationId?: string,
): Promise<ManagedDeliberationOutcome> {
  if ("resumeDeliberationId" in request) {
    if (assignedDeliberationId !== undefined) {
      throw new ManagedDeliberationError(
        "deliberation_request_invalid",
        "A new deliberation ID cannot be assigned to a resume request.",
      );
    }
    return resumeManagedDeliberationWithStorage(request, storage, dependencies);
  }
  const writingContract = await resolveWritingContract(
    storage.paths.repositoryRoot,
    dependencies.writingContract,
  );
  const plan = await resolveExecutionPlan(request, storage, writingContract);
  const policy = plan.policy;
  const recipientRoleIds = plan.participants.map((participant) => participant.role.roleId);
  const deliberationId = assignedDeliberationId ?? dependencies.createId("dlb");
  const registry = await loadDocumentRegistry(storage.paths.repositoryRoot);
  const workspace = await DeliberationWorkspace.create({
    repositoryRoot: storage.paths.repositoryRoot,
    stateRoot: storage.paths.state,
    deliberationId,
    registry,
    createdAt: dependencies.now().toISOString(),
    participantRoleIds: recipientRoleIds,
    writingContract,
  });
  const runtimeCoordinates: DeliberationRuntimeCoordinates = {
    projectId: storage.manifest.projectId,
    runId: dependencies.createId("run"),
    sessionId: dependencies.createId("ses"),
  };
  const runtime = new DeliberationRuntime({
    deliberationId,
    policy,
    policyVersion: deliberationPolicyHash(policy),
    coordinates: runtimeCoordinates,
    events: storage.events,
    artifactStore: storage.artifacts,
    now: dependencies.now,
    createEventId: () => dependencies.createId("evt"),
  });
  const runner = new ManagedDeliberationRunner(
    storage,
    workspace,
    deliberationPolicyHash(policy),
    policy.requiredVerificationSuiteIds[0]!,
    dependencies.runner,
    {
      workId: rootWorkId(runtimeCoordinates.projectId, runtimeCoordinates.runId),
      runId: runtimeCoordinates.runId,
    },
  );
  let completed = false;
  let leaseOwnerId: string | null = null;
  let openBlockingObjections: string[] = [];
  runtime.start();
  try {
    const rounds = await executeDeliberationRounds({
      request,
      plan,
      policy,
      deliberationId,
      runtime,
      runner,
      workspace,
      recipientRoleIds,
      now: dependencies.now,
      setOpenBlockingObjectionIds: (ids) => {
        openBlockingObjections = [...ids];
      },
    });
    if (rounds.status === "no_consensus") {
      completed = true;
      return rounds.result;
    }
    leaseOwnerId = dependencies.createId("dlw");
    await acquireDeliberationLease({
      stateRoot: storage.paths.state,
      deliberationId,
      ownerId: leaseOwnerId,
      acquiredAt: dependencies.now().toISOString(),
      recoverStale: false,
    });
    await writeApprovedDeliberationCheckpoint({
      stateRoot: storage.paths.state,
      checkpoint: {
        schemaVersion: 1,
        deliberationId,
        policyHash: deliberationPolicyHash(policy),
        request: checkpointRequest(request),
        runtimeCoordinates,
        runtime: runtime.snapshot(),
        workspace: workspace.snapshot(),
        latestClaimArtifactId: rounds.latestClaimArtifact.artifact.deliberationArtifactId,
        approvedReviewArtifactIds: rounds.approvedReviews.map(
          (review) => review.artifact.deliberationArtifactId,
        ),
        currentClaim: rounds.currentClaim,
        createdAt: dependencies.now().toISOString(),
      },
    });
    await dependencies.afterApprovedCheckpoint?.(deliberationId);
    const result = await completeApprovedDeliberation({
      request,
      plan,
      deliberationId,
      policy,
      runtime,
      runner,
      workspace,
      proposer: plan.proposer,
      verifier: plan.verifier,
      approvedReviews: rounds.approvedReviews,
      recipientRoleIds,
      latestClaimArtifact: rounds.latestClaimArtifact,
      currentClaim: rounds.currentClaim,
      now: dependencies.now,
    });
    completed = true;
    await releaseDeliberationLease({
      stateRoot: storage.paths.state,
      deliberationId,
      ownerId: leaseOwnerId,
    });
    leaseOwnerId = null;
    return result;
  } catch (error) {
    if (!completed && !(error instanceof DeliberationProcessInterruptedError)) {
      try {
        runtime.complete(
          createFailedOutcome({
            deliberationId,
            policy,
            history: runtime.history(),
            completedAt: dependencies.now().toISOString(),
            unresolvedBlockingObjectionIds: openBlockingObjections,
            code: errorCode(error),
          }),
        );
      } catch {
        // Preserve the original failure instead of presenting incomplete history as completed.
      }
    }
    if (leaseOwnerId !== null) {
      try {
        await releaseDeliberationLease({
          stateRoot: storage.paths.state,
          deliberationId,
          ownerId: leaseOwnerId,
        });
      } catch {
        // Preserve the run failure. A later resume will assess the remaining lease conservatively.
      }
    }
    throw error;
  }
}

function checkpointRequest(
  request: StartManagedDeliberationRequest,
): ApprovedDeliberationCheckpoint["request"] {
  if (typeof request.policyId === "string") {
    return { policyId: request.policyId, topic: request.topic };
  }
  return {
    proposerProvider: request.proposerProvider,
    reviewerProvider: request.reviewerProvider,
    verificationSuiteIds: [...request.verificationSuiteIds],
    topic: request.topic,
  };
}

export const executeManagedDeliberation = createManagedDeliberationExecutor();
