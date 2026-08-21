import { randomUUID } from "node:crypto";

import { deliberationPolicyHash } from "@lervo/deliberation";
import {
  DeliberationRuntime,
} from "@lervo/deliberation-runtime";
import { loadDocumentRegistry } from "@lervo/project";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import type { DeliberationOutcome, DeliberationResponsibility } from "@lervo/schemas";

import { completeApprovedDeliberation } from "./deliberation-convergence.js";
import {
  createFailedOutcome,
} from "./deliberation-contract.js";
import { executeDeliberationRounds } from "./deliberation-rounds.js";
import { loadDeliberationWorkflowSource } from "./deliberation-policy-loader.js";
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

export type ManagedDeliberationRequest =
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

function validSuites(suites: readonly string[]): boolean {
  return suites.length > 0 && suites.length <= 16 &&
    new Set(suites).size === suites.length && suites.every((suiteId) =>
      suiteId.length <= 150 && /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(suiteId));
}

function assertRequest(request: ManagedDeliberationRequest): void {
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
  request: ManagedDeliberationRequest,
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
  const runtime = new DeliberationRuntime({
    deliberationId,
    policy,
    policyVersion: deliberationPolicyHash(policy),
    coordinates: {
      projectId: storage.manifest.projectId,
      runId: dependencies.createId("run"),
      sessionId: dependencies.createId("ses"),
    },
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
    if (!completed) {
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

export const executeManagedDeliberation = createManagedDeliberationExecutor();
