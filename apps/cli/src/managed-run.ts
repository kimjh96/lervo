import { createHash, randomUUID } from "node:crypto";

import type { ProviderAdapter } from "@lervo/adapter-contract";
import { assertAssignmentExecutionAuthority, completeAssignment } from "@lervo/agent-workforce";
import type { WorkforceAgent } from "@lervo/agent-workforce";
import { ClaudeAdapter } from "@lervo/adapter-claude";
import { CodexAdapter } from "@lervo/adapter-codex";
import {
  documentIdForPath,
  normalizeRepositoryPath,
  type ManagedLinkedEvidenceSelection,
} from "@lervo/context";
import { writingContractForLanguage } from "@lervo/core";
import {
  ManagedProviderRunCoordinator,
  type ManagedFileChangeEvidence,
  type ManagedProviderResultArtifact,
  type ManagedProjectVerification,
} from "@lervo/orchestrator";
import { loadDocumentRegistry } from "@lervo/project";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { loadRepositoryKnowledgePolicy } from "@lervo/repository-knowledge";
import type { AdapterCapabilityActivationReceipt } from "@lervo/schemas";
import { resolveRoleContract } from "@lervo/roles";
import {
  evaluateWritingPublication,
  type WritingPublicationResult,
  type WritingSemanticEvaluator,
} from "@lervo/writing";

import { createDeveloperRole, createDeveloperTurnInstructions } from "./developer-role.js";
import {
  createLocalProviderWritingEvaluator,
  type LocalProviderWritingEvaluatorInput,
} from "./managed-writing-evaluator.js";
import {
  executeManagedLinkedEvidenceCanary,
  recordManagedLinkedEvidenceCanaryCompletion,
  recordManagedLinkedEvidenceCanaryFailure,
  type ManagedLinkedEvidenceCanaryAuthorization,
  type ManagedLinkedEvidenceCanaryOutcome,
} from "./managed-linked-evidence-canary.js";
import { resolveDeterministicManagedLinkedEvidenceSelection } from "./managed-linked-evidence-deterministic-selection.js";
import type { resolveDefaultManagedLinkedEvidenceSelection } from "./managed-linked-evidence-default-selection.js";
import {
  prepareManagedSearchContext,
  summarizeManagedSearchContext,
  type ManagedSearchContextSummary,
} from "./managed-search-context.js";
import { resolveRunSkills, type ResolvedRunSkill } from "./run-skills.js";
import { resolveRunCapabilities } from "./run-capabilities.js";
import type { ResolvedCapability } from "@lervo/capabilities";
import { verifiedCurrentWorkstream } from "./workstream-services.js";
import { recordWorkforceEvent } from "./workforce-events.js";
import { prepareRunVerification, type PreparedRunVerification } from "./run-verification.js";
import { groundProductionRequest, type GroundProductionRequest } from "./semantic-grounding.js";

export type RunProvider = "codex" | "claude";

export interface ManagedRunRequest {
  repositoryRoot: string;
  provider: RunProvider;
  expectedPath: string;
  instructions: string;
  risk: string;
  skillIds?: readonly string[];
  capabilityIds?: readonly string[];
  verificationSuiteIds: readonly string[];
  workforce?: { assignmentId: string; agentId: string; leaseId: string };
  roleId?: string;
  linkedEvidenceCanaryAuthorization?: ManagedLinkedEvidenceCanaryAuthorization;
}

export interface ManagedRunOutcome {
  provider: RunProvider;
  roleId: string;
  roleVersion: string;
  roleContractHash: string;
  projectId: string;
  runId: string;
  sessionId: string;
  resultArtifact: ManagedProviderResultArtifact;
  writingPublication: WritingPublicationResult;
  managedChanges: ManagedFileChangeEvidence[];
  verificationStatus: "passed" | "failed" | "not_run";
  verifications: readonly ManagedProjectVerification[];
  resolvedSkills: readonly ResolvedRunSkill[];
  resolvedCapabilities: readonly ResolvedCapability[];
  activatedCapabilities: readonly AdapterCapabilityActivationReceipt[];
  searchContext: ManagedSearchContextSummary;
}

export interface ManagedRunDependencies {
  openStorage(root: string): Promise<ProjectStorage>;
  createAdapter(input: {
    provider: RunProvider;
    repositoryRoot: string;
    resolveArtifact: (uri: string) => Promise<Uint8Array>;
    structuredOutputSchema?: Record<string, unknown>;
    selectionBoundary?: "read_only_no_tools";
  }): ProviderAdapter;
  createId(prefix: "run" | "ses" | "evt" | "ctx" | "envelope" | "turn"): string;
  userSkillRoot?: string;
  userCapabilityRoot?: string;
  semanticEvaluator?: WritingSemanticEvaluator;
  createSemanticEvaluator?: (input: LocalProviderWritingEvaluatorInput) => WritingSemanticEvaluator;
  now?: () => Date;
  createSearchNonce?: () => string;
  prepareVerification?(input: {
    repositoryRoot: string;
    suiteIds: readonly string[];
    artifactStore: ProjectStorage["artifacts"];
    now?: () => Date;
  }): Promise<PreparedRunVerification>;
  groundProductionRequest?: GroundProductionRequest;
  /** Internal paired-evaluation seam; ordinary application composition leaves this undefined. */
  resolveExperimentalLinkedEvidenceSelection?: typeof resolveDefaultManagedLinkedEvidenceSelection;
}

export type ExecuteManagedRun = (request: ManagedRunRequest) => Promise<ManagedRunOutcome>;

export class ManagedRunCommandError extends Error {
  constructor(
    readonly code: "cleanup_failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ManagedRunCommandError";
  }
}

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

const defaultDependencies: ManagedRunDependencies = {
  openStorage: openProjectStorage,
  createAdapter: ({
    provider,
    repositoryRoot,
    resolveArtifact,
    structuredOutputSchema,
    selectionBoundary,
  }) =>
    provider === "codex"
      ? new CodexAdapter({
          repositoryRoot,
          resolveArtifact,
          ...(structuredOutputSchema === undefined ? {} : { structuredOutputSchema }),
          ...(selectionBoundary === "read_only_no_tools"
            ? {
                sandbox: "read-only",
                approvalPolicy: "never",
                transport: {
                  kind: "responses_api_no_tools",
                  ...(process.env.OPENAI_API_KEY === undefined
                    ? {}
                    : { apiKey: process.env.OPENAI_API_KEY }),
                  ...(process.env.LERVO_CODEX_NO_TOOL_MODEL === undefined
                    ? {}
                    : { model: process.env.LERVO_CODEX_NO_TOOL_MODEL }),
                } as const,
              }
            : {}),
        })
      : new ClaudeAdapter({
          repositoryRoot,
          resolveArtifact,
          ...(structuredOutputSchema === undefined ? {} : { structuredOutputSchema }),
          ...(selectionBoundary === "read_only_no_tools"
            ? { permissionMode: "plan", tools: [] }
            : {}),
        }),
  createId: (prefix) => `${prefix}_${randomUUID().replaceAll("-", "")}`,
  now: () => new Date(),
  createSemanticEvaluator: createLocalProviderWritingEvaluator,
  groundProductionRequest,
};

export function createManagedRunExecutor(
  dependencies: ManagedRunDependencies = defaultDependencies,
): ExecuteManagedRun {
  return async (request) => {
    const expectedPath = normalizeRepositoryPath(request.expectedPath);
    const instructions = request.instructions.trim();
    let skillIds = [...new Set(request.skillIds ?? [])].sort();
    const requestedCapabilityIds = [...new Set(request.capabilityIds ?? [])].sort();
    const verificationSuiteIds = [...request.verificationSuiteIds].sort();
    const roleId = request.roleId ?? "developer";
    if (
      instructions.length === 0 ||
      request.risk.trim().length === 0 ||
      new Set(verificationSuiteIds).size !== verificationSuiteIds.length ||
      verificationSuiteIds.length === 0 ||
      verificationSuiteIds.length > 16 ||
      verificationSuiteIds.some(
        (suiteId) => !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(suiteId) || suiteId.length > 150,
      )
    ) {
      throw new TypeError(
        "A task request, risk level, and 1 to 16 unique verification suites are required.",
      );
    }

    let storage: ProjectStorage | undefined;
    let outcome: ManagedRunOutcome | undefined;
    let linkedEvidenceCanary: ManagedLinkedEvidenceCanaryOutcome | undefined;
    let linkedEvidenceSelections: readonly ManagedLinkedEvidenceSelection[] = [];
    let linkedEvidenceCanaryFinalizationStarted = false;
    let executionFailure: unknown;
    try {
      storage = await dependencies.openStorage(request.repositoryRoot);
      const roleContract = await resolveRoleContract(storage.paths.repositoryRoot, roleId);
      let workforceAgent: WorkforceAgent | undefined;
      if (request.workforce !== undefined) {
        const authority = await assertAssignmentExecutionAuthority({
          repositoryRoot: storage.paths.repositoryRoot,
          assignmentId: request.workforce.assignmentId,
          agentId: request.workforce.agentId,
          leaseId: request.workforce.leaseId,
          provider: request.provider,
          expectedPaths: [expectedPath],
          verificationSuiteIds,
          now: dependencies.now?.() ?? new Date(),
        });
        workforceAgent = authority.agent;
        if (
          authority.assignment.roleId !== roleId ||
          authority.assignment.roleVersion !== roleContract.version ||
          authority.assignment.roleContractHash !== roleContract.contractHash
        )
          throw new TypeError(
            "The managed runner role differs from the leased assignment contract.",
          );
      }
      const knowledgePolicy = await loadRepositoryKnowledgePolicy(storage.paths.repositoryRoot);
      const writingContract = writingContractForLanguage(knowledgePolicy.publication.language);
      const registry = await loadDocumentRegistry(storage.paths.repositoryRoot);
      const role =
        roleId === "developer"
          ? createDeveloperRole(skillIds, verificationSuiteIds)
          : structuredClone(roleContract.definition.profile);
      role.defaultSkills = [...skillIds];
      role.verification.suiteIds = [...verificationSuiteIds];
      const capabilityIds =
        requestedCapabilityIds.length === 0
          ? [...(role.defaultCapabilityPackages ?? [])]
          : requestedCapabilityIds;
      const runCapabilities = await resolveRunCapabilities({
        repositoryRoot: storage.paths.repositoryRoot,
        projectId: storage.manifest.projectId,
        provider: request.provider,
        role,
        capabilityIds,
        query: instructions,
        selectGroundedCapabilityIds: async (candidates) => {
          const grounded = await (
            dependencies.groundProductionRequest ?? defaultDependencies.groundProductionRequest!
          )({
            request: instructions,
            provider: request.provider,
            resolutionContext: {
              priorTurns: [],
              currentWorkstream: null,
              pendingAuthorityIds: [],
              repositoryCondition: "current",
            },
            availableCapabilityIds: candidates.map((candidate) => candidate.capabilityId),
            grantedAuthorities: ["repository_write"],
            semanticCatalog: {
              capabilityCandidates: candidates.map((candidate) => ({
                capabilityId: candidate.capabilityId,
                kind: candidate.kind,
                version: candidate.version,
              })),
              structuredWorkflowSelection: "managed.run",
            },
            workflows: [
              {
                workflowId: "managed.run",
                supportedIntents: ["inspect", "explain", "change", "continue"],
                supportedDispositions: ["execute", "answer"],
                effectIds: ["managed.run"],
                requiredSourceClasses: ["repository_state"],
                authority: "repository_write",
                allowedCapabilityIds: candidates.map((candidate) => candidate.capabilityId),
                crossProviderAllowed: false,
              },
            ],
          });
          return grounded.decision.status === "ready" ? grounded.decision.capabilityIds : [];
        },
        generatedAt: (dependencies.now?.() ?? new Date()).toISOString(),
        ...(dependencies.userCapabilityRoot === undefined
          ? {}
          : { userRoot: dependencies.userCapabilityRoot }),
      });
      if (request.workforce !== undefined) {
        const bound = new Map(
          (workforceAgent?.capabilityPackages ?? []).map((item) => [item.capabilityId, item]),
        );
        if (
          runCapabilities.capabilities.some((item) => {
            const exact = bound.get(item.capabilityId);
            return (
              exact === undefined ||
              exact.version !== item.version ||
              exact.contentHash !== item.contentHash
            );
          })
        )
          throw new TypeError(
            "The managed run capability package set exceeds or differs from the hired agent contract.",
          );
      }
      skillIds = [...new Set([...skillIds, ...runCapabilities.skillIds])].sort();
      role.defaultSkills = [...skillIds];
      const currentWorkstream = await verifiedCurrentWorkstream(storage);
      const workstreamPath = ".lervo/state/workstreams/current.json";
      const workstreamDocumentId = documentIdForPath(workstreamPath);
      if (currentWorkstream !== null)
        role.contextPolicy.requiredDocumentRuleIds.push("repository.workstream");
      const baseProviderInstructions =
        roleId === "developer"
          ? createDeveloperTurnInstructions(instructions)
          : [
              instructions,
              "",
              "Lervo managed role contract:",
              role.description,
              `Return an artifact satisfying ${role.outputContract.schemaRef}.`,
              "Do not claim approvals, evidence, or external effects that are not present in the supplied context.",
            ].join("\n");
      const verification = await (dependencies.prepareVerification ?? prepareRunVerification)({
        repositoryRoot: storage.paths.repositoryRoot,
        suiteIds: verificationSuiteIds,
        artifactStore: storage.artifacts,
        ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      });
      const preparedSkills = await resolveRunSkills({
        repositoryRoot: storage.paths.repositoryRoot,
        projectId: storage.manifest.projectId,
        provider: request.provider,
        role,
        skillIds,
        ...(dependencies.userSkillRoot === undefined
          ? {}
          : { userSkillRoot: dependencies.userSkillRoot }),
        ...(dependencies.userCapabilityRoot === undefined
          ? {}
          : { userCapabilityRoot: dependencies.userCapabilityRoot }),
        generatedAt: (dependencies.now?.() ?? new Date()).toISOString(),
      });
      const resolvedSkills = preparedSkills.resolved;
      const providerInstructions = [
        baseProviderInstructions,
        ...preparedSkills.instructionBlocks.map((skill) =>
          [
            "",
            `Lervo verified skill invocation: ${skill.skillId}@${skill.version} (${skill.contentHash})`,
            "Follow these package-bound instructions for this turn:",
            skill.content,
            `End Lervo verified skill invocation: ${skill.skillId}`,
          ].join("\n"),
        ),
      ].join("\n");
      const policyVersion = digest(JSON.stringify(role));
      const runId = dependencies.createId("run");
      const sessionId = dependencies.createId("ses");
      const searchContext = await prepareManagedSearchContext({
        repositoryRoot: storage.paths.repositoryRoot,
        projectId: storage.manifest.projectId,
        observedAt: dependencies.now?.() ?? new Date(),
        query: instructions,
        fallbackQuery: expectedPath,
        expectedPaths: [expectedPath],
        ...(dependencies.createSearchNonce === undefined
          ? {}
          : { nonce: dependencies.createSearchNonce() }),
        documentRegistry: registry,
      });
      if (request.linkedEvidenceCanaryAuthorization !== undefined) {
        const authorization = request.linkedEvidenceCanaryAuthorization;
        linkedEvidenceCanary =
          authorization.maximumProviderCalls === 0
            ? await resolveDeterministicManagedLinkedEvidenceSelection({
                repositoryRoot: storage.paths.repositoryRoot,
                projectId: storage.manifest.projectId,
                runId,
                provider: request.provider,
                authorization,
                operationalBatch: searchContext.recommendationBatch,
                recommendationBatches: searchContext.recommendationBatches,
                graphRecommendations: searchContext.graphRecommendations,
              })
            : await executeManagedLinkedEvidenceCanary({
                repositoryRoot: storage.paths.repositoryRoot,
                projectId: storage.manifest.projectId,
                runId,
                provider: request.provider,
                request: instructions,
                authorization,
                operationalBatch: searchContext.recommendationBatch,
                recommendationBatches: searchContext.recommendationBatches,
                graphRecommendations: searchContext.graphRecommendations,
                resolveArtifact: (uri) => storage!.artifacts.get(uri),
                createAdapter: dependencies.createAdapter,
                now: dependencies.now ?? (() => new Date()),
              });
        linkedEvidenceSelections = linkedEvidenceCanary.selections;
      } else if (dependencies.resolveExperimentalLinkedEvidenceSelection !== undefined) {
        linkedEvidenceSelections = await dependencies.resolveExperimentalLinkedEvidenceSelection({
          repositoryRoot: storage.paths.repositoryRoot,
          runId,
          operationalBatch: searchContext.recommendationBatch,
          recommendationBatches: searchContext.recommendationBatches,
          graphRecommendations: searchContext.graphRecommendations,
        });
      }
      const adapter = dependencies.createAdapter({
        provider: request.provider,
        repositoryRoot: storage.paths.repositoryRoot,
        resolveArtifact: (uri) => storage!.artifacts.get(uri),
      });
      const coordinator = new ManagedProviderRunCoordinator({
        adapter,
        artifactStore: storage.artifacts,
        events: storage.events,
        coordinates: {
          projectId: storage.manifest.projectId,
          runId,
          sessionId,
          roleId: role.roleId,
        },
        policyVersion,
        createEventId: () => dependencies.createId("evt"),
        projectVerifier: verification.verifier,
      });
      const result = await coordinator.run({
        repositoryRoot: storage.paths.repositoryRoot,
        workCausality: {
          relationship: "root",
          workstreamId: currentWorkstream?.workstreamId ?? null,
        },
        requestDigest: digest(instructions),
        risk: request.risk.trim(),
        instructions: providerInstructions,
        targetTurnId: dependencies.createId("turn"),
        context: {
          registry,
          role,
          expectedPaths: [expectedPath],
          publications: [],
          handoffs: [],
          recommendationBatches: searchContext.recommendationBatches,
          graphRecommendations: searchContext.graphRecommendations,
          ...(linkedEvidenceSelections.length === 0
            ? {}
            : linkedEvidenceCanary === undefined
              ? { defaultLinkedEvidenceSelections: linkedEvidenceSelections }
              : { linkedEvidenceSelections }),
          documentRules:
            currentWorkstream === null ? {} : { "repository.workstream": [workstreamDocumentId] },
          additionalCandidates: [
            ...searchContext.additionalCandidates,
            ...(currentWorkstream === null
              ? []
              : [
                  {
                    documentId: workstreamDocumentId,
                    path: workstreamPath,
                    connectedPaths: [],
                    source: "workstream" as const,
                    documentRole: "governance_context" as const,
                    referenceEligible: false,
                  },
                ]),
          ],
          createReceiptId: () => dependencies.createId("ctx"),
        },
        writingPolicy: null,
        resolvedSkills,
        resolvedCapabilities: runCapabilities.capabilities.map((item) => ({
          capabilityId: item.capabilityId,
          capabilityKind: item.kind,
          version: item.version,
          contentHash: item.contentHash,
          sourceKind: item.sourceKind,
          selectionReason: runCapabilities.recommendations.some(
            (recommendation) => recommendation.capabilityId === item.capabilityId,
          )
            ? ("natural_language" as const)
            : capabilityIds.includes(item.capabilityId)
              ? requestedCapabilityIds.length > 0
                ? ("explicit" as const)
                : ("role_default" as const)
              : ("dependency" as const),
        })),
        capabilityRecommendations: runCapabilities.recommendations.map((item) => ({
          capabilityId: item.capabilityId,
          capabilityKind: item.kind,
          version: item.version,
          contentHash: item.contentHash,
          score: item.score,
          reasonCodes: item.reasonCodes,
        })),
        capabilityActivations: runCapabilities.activations,
        verificationSuites: verification.suites,
        createEnvelopeId: () => dependencies.createId("envelope"),
        createEvidenceReceiptId: () => dependencies.createId("ctx"),
      });
      if (linkedEvidenceCanary !== undefined) {
        linkedEvidenceCanaryFinalizationStarted = true;
        await recordManagedLinkedEvidenceCanaryCompletion({
          repositoryRoot: storage.paths.repositoryRoot,
          outcome: linkedEvidenceCanary,
          evidence: result.contextEvidence,
          recordedAt: dependencies.now?.() ?? new Date(),
        });
      }
      const writingPublication = await evaluateWritingPublication(
        {
          artifact: result.resultArtifact,
          contract: writingContract,
          surface: "chat",
          artifactStore: storage.artifacts,
          ...(dependencies.semanticEvaluator !== undefined
            ? { semanticEvaluator: dependencies.semanticEvaluator }
            : dependencies.createSemanticEvaluator === undefined
              ? {}
              : {
                  semanticEvaluator: dependencies.createSemanticEvaluator({
                    provider: request.provider,
                    projectId: storage.manifest.projectId,
                    createAdapter: dependencies.createAdapter,
                    createId: dependencies.createId,
                    now: dependencies.now ?? (() => new Date()),
                  }),
                }),
        },
        dependencies.now === undefined ? {} : { now: dependencies.now },
      );
      outcome = {
        provider: request.provider,
        roleId,
        roleVersion: roleContract.version,
        roleContractHash: roleContract.contractHash,
        projectId: storage.manifest.projectId,
        runId,
        sessionId,
        resultArtifact: result.resultArtifact,
        writingPublication,
        managedChanges: result.managedChanges,
        verificationStatus: result.verificationStatus,
        verifications: result.verifications,
        resolvedSkills,
        resolvedCapabilities: runCapabilities.capabilities,
        activatedCapabilities: result.capabilityActivations,
        searchContext: summarizeManagedSearchContext(
          searchContext.attempt.attemptId,
          searchContext.knowledgeAttempt.attemptId,
          result.contextEvidence,
          searchContext.graphRecommendations,
        ),
      };
      if (request.workforce !== undefined) {
        await completeAssignment({
          repositoryRoot: storage.paths.repositoryRoot,
          assignmentId: request.workforce.assignmentId,
          agentId: request.workforce.agentId,
          leaseId: request.workforce.leaseId,
          resultArtifacts: [
            {
              artifactId: result.resultArtifact.artifactId,
              contentHash: result.resultArtifact.contentHash,
            },
          ],
          verificationStatus:
            result.verificationStatus === "passed" && writingPublication.status === "allowed"
              ? "passed"
              : "failed",
          ...(result.verificationStatus === "passed" && writingPublication.status === "allowed"
            ? {}
            : { failureCode: "managed_run_not_publishable" }),
          now: dependencies.now?.() ?? new Date(),
          recordEvent: (event) => recordWorkforceEvent(storage!, event),
        });
      }
    } catch (error) {
      executionFailure = error;
      if (
        storage !== undefined &&
        linkedEvidenceCanary !== undefined &&
        !linkedEvidenceCanaryFinalizationStarted
      ) {
        try {
          await recordManagedLinkedEvidenceCanaryFailure({
            repositoryRoot: storage.paths.repositoryRoot,
            outcome: linkedEvidenceCanary,
            recordedAt: dependencies.now?.() ?? new Date(),
          });
        } catch (recordError) {
          executionFailure = new AggregateError(
            [error, recordError],
            "The managed run and its canary failure record both failed.",
          );
        }
      }
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
      throw new ManagedRunCommandError(
        "cleanup_failed",
        executionFailure === undefined
          ? "Could not close project storage after the managed run."
          : "Could not close project storage after the managed run failed.",
        {
          cause:
            executionFailure === undefined
              ? cleanupFailure
              : new AggregateError([executionFailure, cleanupFailure]),
        },
      );
    }
    if (executionFailure !== undefined) throw executionFailure;
    if (outcome === undefined) {
      throw new TypeError("The managed run has no result.");
    }
    return outcome;
  };
}

export const executeManagedRun = createManagedRunExecutor();
