import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";

import { koreanConversationWritingContract, writingContractForLanguage } from "@lervo/core";
import { calculateConversationDeliberationOriginBindingDigest } from "@lervo/conversation-control";
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
  DeliberationParticipantAssignment,
  DeliberationOutcome,
  DeliberationResponsibility,
  WritingContract,
} from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";

import { completeApprovedDeliberation } from "./deliberation-convergence.js";
import {
  writeApprovedDeliberationCheckpoint,
  type ApprovedDeliberationCheckpoint,
} from "./deliberation-checkpoint.js";
import { createFailedOutcome } from "./deliberation-contract.js";
import { executeDeliberationRounds } from "./deliberation-rounds.js";
import {
  applyBoundDeliberationParticipantRoles,
  bindAssignedDeliberationParticipants,
  releaseAssignedDeliberationParticipants,
} from "./deliberation-participant-binding.js";
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
import {
  prepareManagedDeliberationEvidence,
  type ManagedDeliberationEvidenceBundle,
} from "./managed-deliberation-evidence.js";
import type { RunProvider } from "./managed-run.js";

export { ManagedDeliberationError } from "./managed-deliberation-errors.js";

interface ManagedDeliberationRequestBase {
  repositoryRoot: string;
  topic: string;
  responseLanguage?: "en" | "ko";
  providerExecutables?: Partial<Record<RunProvider, string>>;
  providerModels?: Partial<Record<RunProvider, string>>;
  providerReasoningEfforts?: Partial<
    Record<RunProvider, "low" | "medium" | "high" | "xhigh" | "max">
  >;
  executionMaximumElapsedMs?: number;
  participantAssignments?: readonly DeliberationParticipantAssignment[];
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
  providerExecutables?: Partial<Record<RunProvider, string>>;
  providerModels?: Partial<Record<RunProvider, string>>;
  providerReasoningEfforts?: Partial<
    Record<RunProvider, "low" | "medium" | "high" | "xhigh" | "max">
  >;
  executionMaximumElapsedMs?: number;
  participantAssignments?: readonly DeliberationParticipantAssignment[];
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
  origin?: {
    sourceEventId: string;
    conversationId: string;
    threadId: string | null;
    requesterParticipantId: string;
    originBindingDigest: string;
  };
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
  prepareEvidence?(input: {
    repositoryRoot: string;
    topic: string;
    documentRegistry: Awaited<ReturnType<typeof loadDocumentRegistry>>;
  }): Promise<ManagedDeliberationEvidenceBundle>;
  afterApprovedCheckpoint?(deliberationId: string): Promise<void> | void;
}

const defaultDependencies: ManagedDeliberationDependencies = {
  openStorage: openProjectStorage,
  createId: (prefix) => `${prefix}_${randomUUID().replaceAll("-", "")}`,
  now: () => new Date(),
  prepareEvidence: prepareManagedDeliberationEvidence,
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
  const providerExecutables = request.providerExecutables ?? {};
  const providerModels = request.providerModels ?? {};
  const providerReasoningEfforts = request.providerReasoningEfforts ?? {};
  if (
    request.participantAssignments !== undefined &&
    (request.participantAssignments.length < 1 ||
      request.participantAssignments.length > 32 ||
      request.participantAssignments.some(
        (item) => !validateSchema("deliberationParticipantAssignment", item).valid,
      ) ||
      new Set(request.participantAssignments.map((item) => item.policyRoleId)).size !==
        request.participantAssignments.length)
  ) {
    throw new ManagedDeliberationError(
      "deliberation_request_invalid",
      "Managed deliberation participant assignments are invalid or duplicated.",
    );
  }
  if (
    request.executionMaximumElapsedMs !== undefined &&
    (!Number.isSafeInteger(request.executionMaximumElapsedMs) ||
      request.executionMaximumElapsedMs < 1_000 ||
      request.executionMaximumElapsedMs > 3_600_000)
  ) {
    throw new ManagedDeliberationError(
      "deliberation_request_invalid",
      "The managed deliberation execution deadline is invalid.",
    );
  }
  if (
    Object.entries(providerExecutables).some(
      ([provider, executable]) =>
        !["codex", "claude"].includes(provider) ||
        typeof executable !== "string" ||
        !isAbsolute(executable) ||
        /[\0\r\n]/u.test(executable) ||
        executable.length > 4096,
    )
  ) {
    throw new ManagedDeliberationError(
      "deliberation_request_invalid",
      "Managed deliberation provider executables must be safe absolute paths.",
    );
  }
  if (
    Object.entries(providerModels).some(
      ([provider, model]) =>
        !["codex", "claude"].includes(provider) ||
        typeof model !== "string" ||
        model.length === 0 ||
        model.length > 128 ||
        /[\0\r\n]/u.test(model),
    ) ||
    Object.entries(providerReasoningEfforts).some(
      ([provider, effort]) =>
        !["codex", "claude"].includes(provider) ||
        !["low", "medium", "high", "xhigh", "max"].includes(String(effort)),
    )
  ) {
    throw new ManagedDeliberationError(
      "deliberation_request_invalid",
      "Managed deliberation provider models and reasoning efforts are invalid.",
    );
  }
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
  responseLanguage: "en" | "ko" | undefined,
): Promise<WritingContract> {
  if (override !== undefined) return structuredClone(override);
  if (responseLanguage === "ko") return structuredClone(koreanConversationWritingContract);
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
    if (
      assignment.origin !== undefined &&
      ("resumeDeliberationId" in assignment.request ||
        !/^cve_[a-f0-9]{64}$/u.test(assignment.origin.sourceEventId) ||
        !/^cnv_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(assignment.origin.conversationId) ||
        (assignment.origin.threadId !== null &&
          !/^thd_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(assignment.origin.threadId)) ||
        !/^ptc_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(assignment.origin.requesterParticipantId) ||
        !/^sha256:[a-f0-9]{64}$/u.test(assignment.origin.originBindingDigest) ||
        calculateConversationDeliberationOriginBindingDigest({
          projectId: assignment.expectedProjectId,
          sourceEventId: assignment.origin.sourceEventId,
          conversationId: assignment.origin.conversationId,
          threadId: assignment.origin.threadId,
          requesterParticipantId: assignment.origin.requesterParticipantId,
        }) !== assignment.origin.originBindingDigest)
    ) {
      throw new ManagedDeliberationError(
        "deliberation_request_invalid",
        "The assigned deliberation origin is invalid.",
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
  const executionStartedAt = dependencies.now().toISOString();
  const writingContract = await resolveWritingContract(
    storage.paths.repositoryRoot,
    dependencies.writingContract,
    request.responseLanguage,
  );
  let plan = await resolveExecutionPlan(request, storage, writingContract);
  const deliberationId = assignedDeliberationId ?? dependencies.createId("dlb");
  const policy = plan.policy;
  const participantExecutions = await bindAssignedDeliberationParticipants({
    storage,
    deliberationId,
    plan,
    ...(request.participantAssignments === undefined
      ? {}
      : { assignments: request.participantAssignments }),
  });
  plan = applyBoundDeliberationParticipantRoles(plan, participantExecutions);
  const recipientRoleIds = plan.participants.map((participant) => participant.role.roleId);
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
    participantNames: plan.participants.map((participant) => ({
      roleId: participant.role.roleId,
      name: participantExecutions.get(participant.role.roleId)?.role.name ?? participant.role.name,
    })),
    now: dependencies.now,
    createEventId: () => dependencies.createId("evt"),
  });
  let completed = false;
  let leaseOwnerId: string | null = null;
  let openBlockingObjections: string[] = [];
  runtime.start();
  try {
    const evidence = await (dependencies.prepareEvidence ?? prepareManagedDeliberationEvidence)({
      repositoryRoot: storage.paths.repositoryRoot,
      topic: request.topic,
      documentRegistry: registry,
    });
    await workspace.installTaskEvidence(evidence);
    const executionBudget = {
      ...policy.executionBudget,
      maximumElapsedMs: Math.min(
        policy.executionBudget.maximumElapsedMs,
        request.executionMaximumElapsedMs ?? policy.executionBudget.maximumElapsedMs,
      ),
    };
    const runner = new ManagedDeliberationRunner(
      storage,
      workspace,
      deliberationPolicyHash(policy),
      policy.requiredVerificationSuiteIds[0]!,
      executionBudget,
      dependencies.runner,
      {
        workId: rootWorkId(runtimeCoordinates.projectId, runtimeCoordinates.runId),
        runId: runtimeCoordinates.runId,
      },
      request.providerExecutables,
      request.providerModels,
      request.providerReasoningEfforts,
      { providerCalls: 0, observedTokens: 0, startedAt: executionStartedAt },
      participantExecutions,
    );
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
      releaseAssignedDeliberationParticipants({
        storage,
        outcome: rounds.result.outcome,
        releasedAt: dependencies.now().toISOString(),
      });
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
        budgetUsage: runner.budgetUsage(),
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
    releaseAssignedDeliberationParticipants({
      storage,
      outcome: result.outcome,
      releasedAt: dependencies.now().toISOString(),
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
        const failedOutcome = createFailedOutcome({
          deliberationId,
          policy,
          history: runtime.history(),
          completedAt: dependencies.now().toISOString(),
          unresolvedBlockingObjectionIds: openBlockingObjections,
          code: errorCode(error),
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
    return {
      policyId: request.policyId,
      topic: request.topic,
      ...(request.executionMaximumElapsedMs === undefined
        ? {}
        : { executionMaximumElapsedMs: request.executionMaximumElapsedMs }),
    };
  }
  return {
    proposerProvider: request.proposerProvider,
    reviewerProvider: request.reviewerProvider,
    verificationSuiteIds: [...request.verificationSuiteIds],
    topic: request.topic,
    ...(request.executionMaximumElapsedMs === undefined
      ? {}
      : { executionMaximumElapsedMs: request.executionMaximumElapsedMs }),
  };
}

export const executeManagedDeliberation = createManagedDeliberationExecutor();
