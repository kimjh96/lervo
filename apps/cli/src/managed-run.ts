import { createHash, randomUUID } from "node:crypto";

import type { ProviderAdapter } from "@lervo/adapter-contract";
import { ClaudeAdapter } from "@lervo/adapter-claude";
import { CodexAdapter } from "@lervo/adapter-codex";
import { normalizeRepositoryPath } from "@lervo/context";
import { writingContractForLanguage } from "@lervo/core";
import {
  ManagedProviderRunCoordinator,
  type ManagedFileChangeEvidence,
  type ManagedProviderResultArtifact,
  type ManagedProjectVerification,
} from "@lervo/orchestrator";
import { loadDocumentRegistry } from "@lervo/project";
import {
  openProjectStorage,
  type ProjectStorage,
} from "@lervo/project-storage";
import { loadRepositoryKnowledgePolicy } from "@lervo/repository-knowledge";
import {
  evaluateWritingPublication,
  type WritingPublicationResult,
  type WritingSemanticEvaluator,
} from "@lervo/writing";

import {
  createDeveloperRole,
  createDeveloperTurnInstructions,
} from "./developer-role.js";
import {
  createLocalProviderWritingEvaluator,
  type LocalProviderWritingEvaluatorInput,
} from "./managed-writing-evaluator.js";
import {
  prepareManagedSearchContext,
  summarizeManagedSearchContext,
  type ManagedSearchContextSummary,
} from "./managed-search-context.js";
import { resolveRunSkills, type ResolvedRunSkill } from "./run-skills.js";
import {
  prepareRunVerification,
  type PreparedRunVerification,
} from "./run-verification.js";

export type RunProvider = "codex" | "claude";

export interface ManagedRunRequest {
  repositoryRoot: string;
  provider: RunProvider;
  expectedPath: string;
  instructions: string;
  risk: string;
  skillIds?: readonly string[];
  verificationSuiteIds: readonly string[];
}

export interface ManagedRunOutcome {
  provider: RunProvider;
  projectId: string;
  runId: string;
  sessionId: string;
  resultArtifact: ManagedProviderResultArtifact;
  writingPublication: WritingPublicationResult;
  managedChanges: ManagedFileChangeEvidence[];
  verificationStatus: "passed" | "failed" | "not_run";
  verifications: readonly ManagedProjectVerification[];
  resolvedSkills: readonly ResolvedRunSkill[];
  searchContext: ManagedSearchContextSummary;
}

export interface ManagedRunDependencies {
  openStorage(root: string): Promise<ProjectStorage>;
  createAdapter(input: {
    provider: RunProvider;
    repositoryRoot: string;
    resolveArtifact: (uri: string) => Promise<Uint8Array>;
  }): ProviderAdapter;
  createId(prefix: "run" | "ses" | "evt" | "ctx" | "envelope" | "turn"): string;
  userSkillRoot?: string;
  semanticEvaluator?: WritingSemanticEvaluator;
  createSemanticEvaluator?: (
    input: LocalProviderWritingEvaluatorInput,
  ) => WritingSemanticEvaluator;
  now?: () => Date;
  createSearchNonce?: () => string;
  prepareVerification?(input: {
    repositoryRoot: string;
    suiteIds: readonly string[];
    artifactStore: ProjectStorage["artifacts"];
    now?: () => Date;
  }): Promise<PreparedRunVerification>;
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
  createAdapter: ({ provider, repositoryRoot, resolveArtifact }) =>
    provider === "codex"
      ? new CodexAdapter({ repositoryRoot, resolveArtifact })
      : new ClaudeAdapter({ repositoryRoot, resolveArtifact }),
  createId: (prefix) => `${prefix}_${randomUUID().replaceAll("-", "")}`,
  now: () => new Date(),
  createSemanticEvaluator: createLocalProviderWritingEvaluator,
};

export function createManagedRunExecutor(
  dependencies: ManagedRunDependencies = defaultDependencies,
): ExecuteManagedRun {
  return async (request) => {
    const expectedPath = normalizeRepositoryPath(request.expectedPath);
    const instructions = request.instructions.trim();
    const skillIds = [...new Set(request.skillIds ?? [])].sort();
    const verificationSuiteIds = [...request.verificationSuiteIds].sort();
    if (
      instructions.length === 0 || request.risk.trim().length === 0 ||
      new Set(verificationSuiteIds).size !== verificationSuiteIds.length ||
      verificationSuiteIds.length === 0 || verificationSuiteIds.length > 16 ||
      verificationSuiteIds.some((suiteId) =>
        !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/.test(suiteId) || suiteId.length > 150)
    ) {
      throw new TypeError(
        "A task request, risk level, and 1 to 16 unique verification suites are required.",
      );
    }

    let storage: ProjectStorage | undefined;
    let outcome: ManagedRunOutcome | undefined;
    let executionFailure: unknown;
    try {
      storage = await dependencies.openStorage(request.repositoryRoot);
      const knowledgePolicy = await loadRepositoryKnowledgePolicy(storage.paths.repositoryRoot);
      const writingContract = writingContractForLanguage(knowledgePolicy.publication.language);
      const registry = await loadDocumentRegistry(storage.paths.repositoryRoot);
      const role = createDeveloperRole(skillIds, verificationSuiteIds);
      const providerInstructions = createDeveloperTurnInstructions(instructions);
      const verification = await (
        dependencies.prepareVerification ?? prepareRunVerification
      )({
        repositoryRoot: storage.paths.repositoryRoot,
        suiteIds: verificationSuiteIds,
        artifactStore: storage.artifacts,
        ...(dependencies.now === undefined ? {} : { now: dependencies.now }),
      });
      const resolvedSkills = await resolveRunSkills({
        repositoryRoot: storage.paths.repositoryRoot,
        projectId: storage.manifest.projectId,
        provider: request.provider,
        role,
        skillIds,
        ...(dependencies.userSkillRoot === undefined
          ? {}
          : { userSkillRoot: dependencies.userSkillRoot }),
        generatedAt: (dependencies.now?.() ?? new Date()).toISOString(),
      });
      const policyVersion = digest(JSON.stringify(role));
      const runId = dependencies.createId("run");
      const sessionId = dependencies.createId("ses");
      const searchContext = await prepareManagedSearchContext({
        repositoryRoot: storage.paths.repositoryRoot,
        projectId: storage.manifest.projectId,
        observedAt: dependencies.now?.() ?? new Date(),
        query: instructions,
        fallbackQuery: expectedPath,
        ...(dependencies.createSearchNonce === undefined
          ? {}
          : { nonce: dependencies.createSearchNonce() }),
        documentRegistry: registry,
      });
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
        requestDigest: digest(instructions),
        risk: request.risk.trim(),
        instructions: providerInstructions,
        targetTurnId: dependencies.createId("turn"),
        context: {
          registry,
          role,
          expectedPaths: [expectedPath],
          documentRules: {},
          publications: [],
          handoffs: [],
          recommendationBatches: searchContext.recommendationBatches,
          additionalCandidates: searchContext.additionalCandidates,
          createReceiptId: () => dependencies.createId("ctx"),
        },
        writingPolicy: null,
        resolvedSkills,
        verificationSuites: verification.suites,
        createEnvelopeId: () => dependencies.createId("envelope"),
        createEvidenceReceiptId: () => dependencies.createId("ctx"),
      });
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
        projectId: storage.manifest.projectId,
        runId,
        sessionId,
        resultArtifact: result.resultArtifact,
        writingPublication,
        managedChanges: result.managedChanges,
        verificationStatus: result.verificationStatus,
        verifications: result.verifications,
        resolvedSkills,
        searchContext: summarizeManagedSearchContext(
          searchContext.attempt.attemptId,
          searchContext.knowledgeAttempt.attemptId,
          result.contextEvidence,
        ),
      };
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
