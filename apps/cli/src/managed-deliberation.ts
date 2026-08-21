import { randomUUID } from "node:crypto";

import { deliberationPolicyHash } from "@lervo/deliberation";
import {
  DeliberationRuntime,
  type DeliberationRuntimeCoordinates,
} from "@lervo/deliberation-runtime";
import { loadDocumentRegistry } from "@lervo/project";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import type { DeliberationOutcome, DeliberationResponsibility } from "@lervo/schemas";

import { completeApprovedDeliberation } from "./deliberation-convergence.js";
import {
  writeApprovedDeliberationCheckpoint,
  type ApprovedDeliberationCheckpoint,
} from "./deliberation-checkpoint.js";
import {
  createFailedOutcome,
} from "./deliberation-contract.js";
import { executeDeliberationRounds } from "./deliberation-rounds.js";
import { loadDeliberationWorkflowSource } from "./deliberation-policy-loader.js";
import {
  acquireDeliberationLease,
  releaseDeliberationLease,
} from "./deliberation-lease.js";
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
  | InlineManagedDeliberationRequest
  | StoredManagedDeliberationRequest;

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
  runner?: ManagedDeliberationRunnerDependencies;
  afterApprovedCheckpoint?(deliberationId: string): Promise<void> | void;
}

const defaultDependencies: ManagedDeliberationDependencies = {
  openStorage: openProjectStorage,
  createId: (prefix) => `${prefix}_${randomUUID().replaceAll("-", "")}`,
  now: () => new Date(),
};

export class DeliberationProcessInterruptedError extends Error {
  constructor(message = "숙의 process가 승인 checkpoint 뒤에 중단되었습니다.") {
    super(message);
    this.name = "DeliberationProcessInterruptedError";
  }
}

function validSuites(suites: readonly string[]): boolean {
  return suites.length > 0 && suites.length <= 16 &&
    new Set(suites).size === suites.length && suites.every((suiteId) =>
      suiteId.length <= 150 && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(suiteId));
}

function assertRequest(request: ManagedDeliberationRequest): void {
  if ("resumeDeliberationId" in request) {
    if (!/^dlb_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(request.resumeDeliberationId)) {
      throw new ManagedDeliberationError(
        "deliberation_request_invalid",
        "재개할 숙의 ID가 유효하지 않습니다.",
      );
    }
    return;
  }
  const topicIsValid = request.topic.trim().length > 0 && request.topic.length <= 20_000;
  const stored = typeof request.policyId === "string";
  const inlineValid = !stored && request.proposerProvider !== request.reviewerProvider &&
    validSuites(request.verificationSuiteIds);
  if (!topicIsValid || (!stored && !inlineValid)) {
    throw new ManagedDeliberationError(
      "deliberation_request_invalid",
      "유효한 작업 주제와 저장된 policy 또는 서로 다른 Codex·Claude 역할 및 verification suite가 필요합니다.",
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
): Promise<DeliberationExecutionPlan> {
  if (typeof request.policyId === "string") {
    const source = await loadDeliberationWorkflowSource(
      storage.paths.repositoryRoot,
      request.policyId,
    );
    return createStoredDeliberationExecutionPlan({
      projectId: storage.manifest.projectId,
      source,
    });
  }
  return createInlineDeliberationExecutionPlan({
    projectId: storage.manifest.projectId,
    proposerProvider: request.proposerProvider,
    reviewerProvider: request.reviewerProvider,
    verificationSuiteIds: request.verificationSuiteIds,
  });
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
        "할당된 숙의 ID가 유효하지 않습니다.",
      );
    }
    assertRequest(assignment.request);
    if (
      "resumeDeliberationId" in assignment.request &&
      assignment.request.resumeDeliberationId !== assignment.deliberationId
    ) {
      throw new ManagedDeliberationError(
        "deliberation_request_invalid",
        "할당된 숙의 ID와 재개할 숙의 ID가 다릅니다.",
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
        "재개 요청에는 새 숙의 ID를 할당할 수 없습니다.",
      );
    }
    return resumeManagedDeliberationWithStorage(request, storage, dependencies);
  }
  const plan = await resolveExecutionPlan(request, storage);
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
        approvedReviewArtifactIds: rounds.approvedReviews.map((review) =>
          review.artifact.deliberationArtifactId),
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
        runtime.complete(createFailedOutcome({
          deliberationId,
          policy,
          history: runtime.history(),
          completedAt: dependencies.now().toISOString(),
          unresolvedBlockingObjectionIds: openBlockingObjections,
          code: errorCode(error),
        }));
      } catch {
        // 원래 실패를 유지합니다. 불완전한 이력을 완료로 위장하지 않습니다.
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
        // 원래 실행 실패를 유지합니다. 남은 lease는 다음 재개에서 보수적으로 판정합니다.
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
