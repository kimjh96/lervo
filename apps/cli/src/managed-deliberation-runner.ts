import { createHash, randomUUID } from "node:crypto";

import type { ProviderAdapter } from "@lervo/adapter-contract";
import {
  createCachedRepositorySnapshotCapture,
  ManagedProviderRunError,
  ManagedProviderRunCoordinator,
  type CaptureRepositorySnapshot,
} from "@lervo/orchestrator";
import type { ProjectStorage } from "@lervo/project-storage";
import type { DeliberationPolicy, RoleProfile, VerificationSuite } from "@lervo/schemas";
import type { ManagedProviderRunResult } from "@lervo/orchestrator";
import { providerSemanticEvaluationSchema } from "@lervo/provider-writing-evaluator";
import type { SemanticWritingEvaluationRequest, WritingSemanticEvaluator } from "@lervo/writing";

import { createDeliberationEvaluatorRole } from "./deliberation-roles.js";
import type { DeliberationWorkspace } from "./deliberation-workspace.js";
import type { RunProvider } from "./managed-run.js";
import { parseSemanticEvaluation } from "./semantic-evaluation-response.js";
import { prepareRunVerification, type PreparedRunVerification } from "./run-verification.js";
import {
  ManagedDeliberationBudgetController,
  type ManagedDeliberationBudgetUsage,
} from "./managed-deliberation-budget.js";
import { createManagedDeliberationAdapter } from "./managed-deliberation-adapter.js";
import type { BoundDeliberationParticipantExecution } from "./deliberation-participant-binding.js";

export { parseSemanticEvaluation } from "./semantic-evaluation-response.js";

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function defaultId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export interface ManagedDeliberationRunnerDependencies {
  createAdapter(input: {
    provider: RunProvider;
    executable?: string;
    model?: string;
    reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
    repositoryRoot: string;
    resolveArtifact: (uri: string) => Promise<Uint8Array>;
    structuredOutputSchema?: Record<string, unknown>;
  }): ProviderAdapter;
  createId(prefix: string): string;
  now(): Date;
  prepareVerification(input: {
    repositoryRoot: string;
    suiteIds: readonly string[];
    artifactStore: ProjectStorage["artifacts"];
    now?: () => Date;
  }): Promise<PreparedRunVerification>;
  createSnapshotCapture?(): CaptureRepositorySnapshot;
  finalizationReserveMs?: number;
}

const defaultDependencies: ManagedDeliberationRunnerDependencies = {
  createAdapter: ({
    provider,
    executable,
    model,
    reasoningEffort,
    repositoryRoot,
    resolveArtifact,
    structuredOutputSchema,
  }) =>
    createManagedDeliberationAdapter({
      provider,
      repositoryRoot,
      resolveArtifact,
      ...(executable === undefined ? {} : { executable }),
      ...(model === undefined ? {} : { model }),
      ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      ...(structuredOutputSchema === undefined ? {} : { structuredOutputSchema }),
    }),
  createId: defaultId,
  now: () => new Date(),
  prepareVerification: prepareRunVerification,
  createSnapshotCapture: createCachedRepositorySnapshotCapture,
};

export interface ManagedDeliberationRunResult {
  run: ManagedProviderRunResult;
  content: string;
  verificationSuite?: VerificationSuite;
}

const maximumSemanticEvaluationAttempts = 2;
const retryableSemanticEvaluationFailures = new Set([
  "provider_start_failed",
  "provider_stream_failed",
  "provider_turn_failed",
  "provider_model_unavailable",
  "provider_result_failed",
  "repository_snapshot_failed",
]);

function mayRetrySemanticEvaluation(error: unknown): boolean {
  return (
    error instanceof ManagedProviderRunError && retryableSemanticEvaluationFailures.has(error.code)
  );
}

function evidenceBoundRole(role: RoleProfile, includeTaskEvidence: boolean): RoleProfile {
  if (!includeTaskEvidence) return role;
  const requiredDocumentRuleIds = [
    ...new Set([...role.contextPolicy.requiredDocumentRuleIds, "deliberation.task-evidence"]),
  ];
  return {
    ...role,
    contextPolicy: { ...role.contextPolicy, requiredDocumentRuleIds },
  };
}

export class ManagedDeliberationRunner {
  private readonly captureSnapshot: CaptureRepositorySnapshot;
  private readonly budget: ManagedDeliberationBudgetController;
  private readonly finalizationReserveMs: number;

  constructor(
    private readonly storage: ProjectStorage,
    private readonly workspace: DeliberationWorkspace,
    private readonly policyVersion: string,
    private readonly defaultVerificationSuiteId: string,
    private readonly executionBudget: NonNullable<DeliberationPolicy["executionBudget"]>,
    private readonly dependencies: ManagedDeliberationRunnerDependencies = defaultDependencies,
    private readonly causalParent?: { workId: string; runId: string },
    private readonly providerExecutables: Partial<Record<RunProvider, string>> = {},
    private readonly providerModels: Partial<Record<RunProvider, string>> = {},
    private readonly providerReasoningEfforts: Partial<
      Record<RunProvider, "low" | "medium" | "high" | "xhigh" | "max">
    > = {},
    initialBudgetUsage?: ManagedDeliberationBudgetUsage,
    private readonly participantExecutions: ReadonlyMap<
      string,
      BoundDeliberationParticipantExecution
    > = new Map(),
  ) {
    this.captureSnapshot = (
      this.dependencies.createSnapshotCapture ?? createCachedRepositorySnapshotCapture
    )();
    this.budget = new ManagedDeliberationBudgetController(
      this.storage.events,
      this.executionBudget,
      this.dependencies.now,
      initialBudgetUsage,
    );
    this.finalizationReserveMs = this.dependencies.finalizationReserveMs ?? 50_000;
  }

  budgetUsage(): ManagedDeliberationBudgetUsage {
    return this.budget.usage();
  }

  async execute(input: {
    provider: RunProvider;
    role: RoleProfile;
    instructions: string;
    documentRules: Record<string, string[]>;
    verificationSuiteId?: string;
    workRelationship?: "deliberation" | "publication_evaluation";
    workAttemptOrdinal?: number;
    structuredOutputSchema?: Record<string, unknown>;
  }): Promise<ManagedDeliberationRunResult> {
    const activeRunDeadlineMs = this.budget.admit(this.finalizationReserveMs);
    const repositoryRoot = this.storage.paths.repositoryRoot;
    const verification =
      input.verificationSuiteId === undefined
        ? undefined
        : await this.dependencies.prepareVerification({
            repositoryRoot,
            suiteIds: [input.verificationSuiteId],
            artifactStore: this.storage.artifacts,
            now: this.dependencies.now,
          });
    const runId = this.dependencies.createId("run");
    const sessionId = this.dependencies.createId("ses");
    const participantExecution = this.participantExecutions.get(input.role.roleId);
    const role = evidenceBoundRole(input.role, input.workRelationship !== "publication_evaluation");
    if (participantExecution !== undefined && participantExecution.provider !== input.provider) {
      throw new ManagedProviderRunError(
        "contract_validation_failed",
        "The accepted participant execution provider differs from the policy-selected provider.",
      );
    }
    const adapter = this.dependencies.createAdapter({
      provider: input.provider,
      ...(this.providerExecutables[input.provider] === undefined
        ? {}
        : { executable: this.providerExecutables[input.provider] }),
      ...((participantExecution?.model ?? this.providerModels[input.provider]) === undefined
        ? {}
        : { model: participantExecution?.model ?? this.providerModels[input.provider] }),
      ...((participantExecution?.reasoningEffort ??
        this.providerReasoningEfforts[input.provider]) === undefined
        ? {}
        : {
            reasoningEffort:
              participantExecution?.reasoningEffort ??
              this.providerReasoningEfforts[input.provider],
          }),
      repositoryRoot,
      resolveArtifact: (uri) => this.storage.artifacts.get(uri),
      ...(input.structuredOutputSchema === undefined
        ? {}
        : { structuredOutputSchema: input.structuredOutputSchema }),
    });
    const coordinator = new ManagedProviderRunCoordinator({
      adapter,
      artifactStore: this.storage.artifacts,
      events: this.storage.events,
      coordinates: {
        projectId: this.storage.manifest.projectId,
        runId,
        sessionId,
        roleId: input.role.roleId,
      },
      policyVersion: this.policyVersion,
      captureSnapshot: this.captureSnapshot,
      createEventId: () => this.dependencies.createId("evt"),
      ...(verification === undefined ? {} : { projectVerifier: verification.verifier }),
      now: this.dependencies.now,
      providerInteractionLimits: {
        maximumToolCalls: 0,
        maximumCommandExecutions: 0,
      },
    });
    const humanPresentation = role.outputContract.presentation.audience !== "machine";
    const controller = new AbortController();
    let elapsedBudgetReached = false;
    const timer = setTimeout(() => {
      elapsedBudgetReached = true;
      controller.abort();
    }, activeRunDeadlineMs);
    timer.unref();
    let run: ManagedProviderRunResult;
    try {
      run = await coordinator.run({
        repositoryRoot,
        requestDigest: digest(input.instructions),
        risk: "medium",
        instructions: input.instructions,
        targetTurnId: this.dependencies.createId("turn"),
        context: {
          registry: this.workspace.registry(),
          role,
          expectedPaths: [],
          documentRules: {
            ...input.documentRules,
            "deliberation.task-evidence": this.workspace.taskEvidenceDocumentIds(),
          },
          publications: this.workspace.publications(),
          handoffs: this.workspace.handoffsFor(input.role.roleId),
          createReceiptId: () => this.dependencies.createId("ctx"),
        },
        writingPolicy: humanPresentation
          ? {
              writingPolicyId: this.workspace.writingContract.writingPolicyId,
              documentId: this.workspace.writingPolicyDocumentId,
              contentHash: this.workspace.writingPolicyContentHash,
            }
          : null,
        resolvedSkills: [],
        signal: controller.signal,
        ...(this.causalParent === undefined
          ? {}
          : {
              workCausality: {
                relationship: input.workRelationship ?? ("deliberation" as const),
                workId: this.causalParent.workId,
                parentRunId: this.causalParent.runId,
                ...(input.workAttemptOrdinal === undefined
                  ? {}
                  : { attemptOrdinal: input.workAttemptOrdinal }),
                ...(participantExecution === undefined
                  ? {}
                  : { agentId: participantExecution.agentId }),
              },
            }),
        ...(verification === undefined ? {} : { verificationSuites: verification.suites }),
        createEnvelopeId: () => this.dependencies.createId("envelope"),
        createEvidenceReceiptId: () => this.dependencies.createId("ctx"),
      });
    } catch (error) {
      if (elapsedBudgetReached) {
        throw this.budget.elapsedError(error);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
    this.budget.observeCompletedRun(runId);
    const bytes = await this.storage.artifacts.get(run.resultArtifact.uri);
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (
      bytes.byteLength !== run.resultArtifact.byteCount ||
      digest(content) !== run.resultArtifact.contentHash
    ) {
      throw new Error("The deliberation provider result does not match its CAS coordinates.");
    }
    return {
      run,
      content,
      ...(verification?.suites[0] === undefined
        ? {}
        : { verificationSuite: structuredClone(verification.suites[0]) }),
    };
  }

  semanticEvaluator(provider: RunProvider): WritingSemanticEvaluator {
    return {
      evaluate: async (request) => {
        for (let attempt = 1; attempt <= maximumSemanticEvaluationAttempts; attempt += 1) {
          try {
            return await this.evaluateSemantics(provider, request, attempt);
          } catch (error) {
            if (
              attempt === maximumSemanticEvaluationAttempts ||
              !mayRetrySemanticEvaluation(error)
            ) {
              throw error;
            }
          }
        }
        throw new Error("The bounded semantic evaluation retry loop did not terminate.");
      },
    };
  }

  private async evaluateSemantics(
    provider: RunProvider,
    request: SemanticWritingEvaluationRequest,
    attemptOrdinal: number,
  ) {
    const requestDocument = `${JSON.stringify(
      {
        schemaVersion: 1,
        writingPolicyId: request.writingPolicyId,
        locale: request.locale,
        surface: request.surface,
        audience: request.audience,
        register: request.register,
        artifactId: request.artifactId,
        contentHash: request.contentHash,
        content: request.content,
        checks: request.checks,
      },
      null,
      2,
    )}\n`;
    const documentId = await this.workspace.materializeSemanticEvaluationRequest(requestDocument);
    const role = createDeliberationEvaluatorRole(
      this.defaultVerificationSuiteId,
      this.workspace.writingContract,
    );
    const result = await this.execute({
      provider,
      role,
      instructions: [
        "Evaluate the text and checks in the writing.evaluation.request document in a separate pass.",
        "Return exactly one JSON object without explanation or a Markdown code fence.",
        'Shape: {"checks":[{"checkId":"...","status":"passed|failed","violationCount":0}]}',
        "Preserve the requested check order and evaluate every check.",
      ].join("\n"),
      documentRules: { "writing.evaluation.request": [documentId] },
      workRelationship: "publication_evaluation",
      workAttemptOrdinal: attemptOrdinal,
      structuredOutputSchema: providerSemanticEvaluationSchema(request),
    });
    return parseSemanticEvaluation(result.content, request, provider);
  }
}
