import { observeManagedRunOutcomes } from "./managed-run-outcomes.js";
import { captureHostOutcomeBaselines } from "@lervo/repository-context";
import { createHash } from "node:crypto";
import { isAbsolute } from "node:path";
import { reserveManagedExecution } from "./managed-execution-reservation.js";
import {
  admitSupervisedManagedRun,
  guardSupervisedProviderStart,
} from "./supervised-managed-run.js";
import { resolveSupervisedManagedWorkspace } from "@lervo/node-runtime";

import { assertAssignmentExecutionAuthority } from "@lervo/agent-workforce";
import type { WorkforceAgent } from "@lervo/agent-workforce";
import { documentIdForPath, type ManagedLinkedEvidenceSelection } from "@lervo/context";
import { writingContractForLanguage } from "@lervo/core";
import { ManagedProviderRunCoordinator } from "@lervo/orchestrator";
import { loadDocumentRegistry } from "@lervo/project";
import { type ProjectStorage } from "@lervo/project-storage";
import { recordManagedRunRepositoryChange } from "./managed-run-repository-change.js";
import { loadRepositoryKnowledgePolicy } from "@lervo/repository-knowledge";
import { resolveRoleContract } from "@lervo/roles";
import { evaluateWritingPublication } from "@lervo/writing";

import { createDeveloperRole, createDeveloperTurnInstructions } from "./developer-role.js";
import { finalizeImmediateManagedAssignment } from "./managed-run-assignment-finalization.js";
import { prepareManagedRunWritingPolicy } from "./managed-run-writing-policy.js";
import { prepareManagedResearchContext } from "./managed-research-context.js";
import { recordManagedRoleProfileActivation } from "./managed-role-profile-activation.js";
import {
  executeManagedLinkedEvidenceCanary,
  recordManagedLinkedEvidenceCanaryCompletion,
  recordManagedLinkedEvidenceCanaryFailure,
  type ManagedLinkedEvidenceCanaryOutcome,
} from "./managed-linked-evidence-canary.js";
import { resolveDeterministicManagedLinkedEvidenceSelection } from "./managed-linked-evidence-deterministic-selection.js";
import {
  prepareManagedSearchContext,
  productDefaultSearchEngine,
  summarizeManagedSearchContext,
} from "./repository-context.js";
import { resolveRunSkills } from "./run-skills.js";
import {
  prepareManagedRunCapabilities,
  capabilitySelectionReason,
} from "./managed-run-capabilities.js";
import { verifiedCurrentWorkstream } from "./workstream-services.js";
import { prepareRunVerification } from "./run-verification.js";
import { resolveManagedRunCausality } from "./managed-run-causality.js";
import { resolveManagedRunExpectedPaths, supervisedRunIsReadOnly } from "./managed-run-request.js";

export { ManagedRunCommandError } from "./managed-run-types.js";
export type {
  RunProvider,
  ManagedRunRequest,
  ManagedRunOutcome,
  ManagedRunDependencies,
  ExecuteManagedRun,
} from "./managed-run-types.js";
import {
  ManagedRunCommandError,
  type ManagedRunDependencies,
  type ExecuteManagedRun,
  type ManagedRunOutcome,
} from "./managed-run-types.js";
import { defaultDependencies } from "./managed-run-composition.js";

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function createManagedRunExecutor(
  dependencies: ManagedRunDependencies = defaultDependencies,
): ExecuteManagedRun {
  return async (request) => {
    const expectedPaths = resolveManagedRunExpectedPaths(request);
    const readOnlyResponsibility = supervisedRunIsReadOnly(request);
    const writablePaths = readOnlyResponsibility ? [] : expectedPaths;
    const instructions = request.instructions.trim();
    let skillIds = [...new Set(request.skillIds ?? [])].sort();
    const requestedCapabilityIds = [...new Set(request.capabilityIds ?? [])].sort();
    const verificationSuiteIds = [...request.verificationSuiteIds].sort();
    const roleId = request.roleId ?? "developer";
    if (
      instructions.length === 0 ||
      (request.executionKey !== undefined &&
        !/^sha256:[a-f0-9]{64}$/u.test(request.executionKey)) ||
      (request.providerExecutable !== undefined &&
        (!isAbsolute(request.providerExecutable) ||
          request.providerExecutable.includes("\0") ||
          request.providerExecutable.length > 4096)) ||
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
      const reserve = () =>
        reserveManagedExecution(storage!, request, dependencies.now?.() ?? new Date());
      const identity =
        request.supervisedInvocation === undefined
          ? reserve()
          : await admitSupervisedManagedRun({
              storage,
              request,
              invocation: request.supervisedInvocation,
              now: () => (dependencies.now?.() ?? new Date()).toISOString(),
              commit: reserve,
            });
      const executionRepositoryRoot =
        request.supervisedInvocation === undefined
          ? storage.paths.repositoryRoot
          : await resolveSupervisedManagedWorkspace(
              storage.paths.repositoryRoot,
              request.supervisedInvocation,
              dependencies.now?.() ?? new Date(),
            );
      const roleContract = await resolveRoleContract(storage.paths.repositoryRoot, roleId);
      let workforceAgent: WorkforceAgent | undefined;
      if (request.workforce !== undefined) {
        const authority = await assertAssignmentExecutionAuthority({
          repositoryRoot: storage.paths.repositoryRoot,
          assignmentId: request.workforce.assignmentId,
          agentId: request.workforce.agentId,
          leaseId: request.workforce.leaseId,
          provider: request.provider,
          expectedPaths,
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
      const currentWorkstream = await verifiedCurrentWorkstream(storage);
      if (request.supervisedInvocation !== undefined && currentWorkstream === null)
        throw new Error("Supervised execution requires its canonical workstream context.");
      const writingContract = writingContractForLanguage(knowledgePolicy.publication.language);
      const repositoryRegistry = await loadDocumentRegistry(storage.paths.repositoryRoot);
      let registry = repositoryRegistry;
      const role =
        roleId === "developer"
          ? createDeveloperRole(skillIds, verificationSuiteIds)
          : structuredClone(roleContract.definition.profile);
      role.defaultSkills = [...skillIds];
      role.verification.suiteIds = [...verificationSuiteIds];
      const managedWriting = await prepareManagedRunWritingPolicy({
        repositoryRoot: storage.paths.repositoryRoot,
        dataDirectory: storage.paths.data,
        registry,
        role,
        writingContract,
        verifiedAt: storage.manifest.createdAt,
      });
      registry = managedWriting.registry;
      const research = await prepareManagedResearchContext({
        repositoryRoot: storage.paths.repositoryRoot,
        projectId: storage.manifest.projectId,
        role,
        roleContractHash: roleContract.contractHash,
        researchQuestion:
          request.supervisedInvocation?.effect.responsibility.taskPurpose ?? instructions,
        expectedPaths,
        registry,
        artifacts: storage.artifacts,
        now: () => (dependencies.now?.() ?? new Date()).toISOString(),
      });
      if (research !== null) registry = research.registry;
      const { capabilityIds, runCapabilities } = await prepareManagedRunCapabilities({
        storage,
        request,
        dependencies,
        instructions,
        requestedCapabilityIds,
        role,
        ...(workforceAgent ? { workforceAgent } : {}),
      });
      skillIds = [...new Set([...skillIds, ...runCapabilities.skillIds])].sort();
      role.defaultSkills = [...skillIds];
      const workCausality = resolveManagedRunCausality({
        ...(request.workCausality === undefined ? {} : { requested: request.workCausality }),
        currentWorkstream,
        ...(request.workforce === undefined ? {} : { workforce: request.workforce }),
      });
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
        ...(research === null
          ? {}
          : {
              research: {
                inputArtifactHash: research.binding.inputArtifactHash,
                casRoot: storage.paths.cas,
              },
            }),
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
        ...(research === null ? [] : [research.instructions]),
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
      const runId = identity?.runId ?? dependencies.createId("run");
      const sessionId = identity?.sessionId ?? dependencies.createId("ses");
      const searchContext = await prepareManagedSearchContext({
        recordingCoordinates: { runId, sessionId },
        repositoryRoot: storage.paths.repositoryRoot,
        projectId: storage.manifest.projectId,
        observedAt: dependencies.now?.() ?? new Date(),
        ...(dependencies.resolveExperimentalLinkedEvidenceSelection === undefined
          ? { productDefault: productDefaultSearchEngine }
          : {}),
        query: instructions,
        fallbackQuery: expectedPaths[0]!,
        expectedPaths,
        ...(dependencies.createSearchNonce === undefined
          ? {}
          : { nonce: dependencies.createSearchNonce() }),
        documentRegistry:
          request.supervisedInvocation === undefined ? registry : repositoryRegistry,
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
      } else if (
        request.supervisedInvocation === undefined &&
        dependencies.resolveExperimentalLinkedEvidenceSelection !== undefined
      ) {
        linkedEvidenceSelections = await dependencies.resolveExperimentalLinkedEvidenceSelection({
          repositoryRoot: storage.paths.repositoryRoot,
          runId,
          operationalBatch: searchContext.recommendationBatch,
          recommendationBatches: searchContext.recommendationBatches,
          graphRecommendations: searchContext.graphRecommendations,
        });
      }
      const primaryAdapter = dependencies.createAdapter({
        provider: request.provider,
        ...(request.providerExecutable === undefined
          ? {}
          : { executable: request.providerExecutable }),
        repositoryRoot: executionRepositoryRoot,
        resolveArtifact: (uri) => storage!.artifacts.get(uri),
      });
      const adapter =
        request.supervisedInvocation === undefined
          ? primaryAdapter
          : guardSupervisedProviderStart(primaryAdapter, () =>
              admitSupervisedManagedRun({
                storage: storage!,
                request,
                invocation: request.supervisedInvocation!,
                executionRepositoryRoot,
                now: () => (dependencies.now?.() ?? new Date()).toISOString(),
                commit: () => undefined,
              }),
            );
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
        // A supervised attempt stops in flight at the tokens its owner reserved for it.
        ...(request.supervisedInvocation === undefined
          ? {}
          : {
              providerInteractionLimits: {
                maximumTotalTokens: request.supervisedInvocation.effect.reservedTokens,
              },
            }),
      });
      const recommendedCapabilityIds = new Set(
        runCapabilities.recommendations.map((recommendation) => recommendation.capabilityId),
      );
      const outcomeBaselines = await captureHostOutcomeBaselines(
        executionRepositoryRoot,
        writablePaths,
        dependencies.resolveOutcomePolicy !== undefined,
      );
      const result = await coordinator.run({
        repositoryRoot: executionRepositoryRoot,
        ...(request.supervisedInvocation === undefined
          ? {}
          : { contextRepositoryRoot: storage.paths.repositoryRoot }),
        workCausality,
        ...(research === null ? {} : { roleInput: research.binding }),
        ...(readOnlyResponsibility ? { executionMode: "read_only" as const } : {}),
        requestDigest: digest(instructions),
        risk: request.risk.trim(),
        instructions: providerInstructions,
        targetTurnId: dependencies.createId("turn"),
        // Each additional expected path is written in its own target turn.
        createTargetTurnId: () => dependencies.createId("turn"),
        context: {
          registry,
          role,
          expectedPaths: writablePaths,
          publications: [],
          handoffs: [],
          recommendationBatches: searchContext.recommendationBatches,
          graphRecommendations: searchContext.graphRecommendations,
          ...(linkedEvidenceSelections.length === 0
            ? {}
            : linkedEvidenceCanary === undefined
              ? { defaultLinkedEvidenceSelections: linkedEvidenceSelections }
              : { linkedEvidenceSelections }),
          documentRules: {
            ...managedWriting.documentRules,
            ...(research?.documentRules ?? {}),
            ...(currentWorkstream === null
              ? {}
              : { "repository.workstream": [workstreamDocumentId] }),
          },
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
        writingPolicy: managedWriting.writingPolicy,
        resolvedSkills,
        resolvedCapabilities: runCapabilities.capabilities.map((item) => ({
          capabilityId: item.capabilityId,
          capabilityKind: item.kind,
          version: item.version,
          contentHash: item.contentHash,
          sourceKind: item.sourceKind,
          selectionReason: capabilitySelectionReason({
            capabilityId: item.capabilityId,
            authoritativeCapabilityIds: capabilityIds,
            explicitlyRequestedCapabilityIds: requestedCapabilityIds,
            recommendedCapabilityIds,
          }),
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
      if (request.supervisedInvocation === undefined)
        await recordManagedRunRepositoryChange({
          storage,
          runId,
          sessionId,
          policyVersion,
          completion: result,
          eventId: dependencies.createId("evt"),
          occurredAt: (dependencies.now?.() ?? new Date()).toISOString(),
          provider: request.provider,
        });
      recordManagedRoleProfileActivation({
        storage,
        runId,
        sessionId,
        provider: request.provider,
        roleContract,
        runtimeProfileHash: policyVersion,
        activatedAt: (dependencies.now?.() ?? new Date()).toISOString(),
        createEventId: () => dependencies.createId("evt"),
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
      const outcomePolicy = await dependencies.resolveOutcomePolicy?.({ request, result, storage });
      const contextQuality = await observeManagedRunOutcomes({
        storage,
        executionRepositoryRoot,
        run: result,
        instructions,
        baselines: outcomeBaselines,
        ...(outcomePolicy ? { policy: outcomePolicy } : {}),
      });
      const writingPublication = await evaluateWritingPublication(
        {
          artifact: result.resultArtifact,
          contract: writingContract,
          surface: "chat",
          artifactStore: storage.artifacts,
          ...(request.supervisedInvocation !== undefined
            ? {}
            : dependencies.semanticEvaluator !== undefined
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
        contextQuality,
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
      if (
        request.workforce !== undefined &&
        (request.assignmentFinalization ?? "immediate") === "immediate"
      ) {
        await finalizeImmediateManagedAssignment({
          storage,
          workforce: request.workforce,
          resultArtifact: result.resultArtifact,
          verificationStatus: result.verificationStatus,
          writingPublicationStatus: writingPublication.status,
          now: dependencies.now?.() ?? new Date(),
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
