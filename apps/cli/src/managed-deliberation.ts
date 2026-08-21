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
import type { RunProvider } from "./managed-run.js";

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

export class ManagedDeliberationError extends Error {
  constructor(
    readonly code: "deliberation_cleanup_failed" | "deliberation_request_invalid",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ManagedDeliberationError";
  }
}

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
) {
  return async (request: ManagedDeliberationRequest): Promise<ManagedDeliberationOutcome> => {
    assertRequest(request);
    let storage: ProjectStorage | undefined;
    let executionFailure: unknown;
    let result: ManagedDeliberationOutcome | undefined;
    try {
      storage = await dependencies.openStorage(request.repositoryRoot);
      result = await executeWithStorage(request, storage, dependencies);
    } catch (error) {
      executionFailure = error;
    }
    let cleanupFailure: unknown;
    if (storage !== undefined) {
      try {
        await storage.close();
      } catch (error) {
        cleanupFailure = error;
      }
    }
    if (cleanupFailure !== undefined) {
      throw new ManagedDeliberationError(
        "deliberation_cleanup_failed",
        executionFailure === undefined
          ? "숙의 뒤 project storage를 닫지 못했습니다."
          : "숙의 실패 뒤 project storage도 닫지 못했습니다.",
        { cause: executionFailure === undefined
          ? cleanupFailure
          : new AggregateError([executionFailure, cleanupFailure]) },
      );
    }
    if (executionFailure !== undefined) throw executionFailure;
    if (result === undefined) throw new Error("숙의 결과가 없습니다.");
    return result;
  };
}

async function executeWithStorage(
  request: ManagedDeliberationRequest,
  storage: ProjectStorage,
  dependencies: ManagedDeliberationDependencies,
): Promise<ManagedDeliberationOutcome> {
  if ("resumeDeliberationId" in request) {
    return resumeManagedDeliberationWithStorage(request, storage, dependencies);
  }
  const plan = await resolveExecutionPlan(request, storage);
  const policy = plan.policy;
  const recipientRoleIds = plan.participants.map((participant) => participant.role.roleId);
  const deliberationId = dependencies.createId("dlb");
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
