import { createHash, randomUUID } from "node:crypto";

import type { ProviderAdapter } from "@lervo/adapter-contract";
import { ClaudeAdapter } from "@lervo/adapter-claude";
import { CodexAdapter } from "@lervo/adapter-codex";
import { normalizeRepositoryPath } from "@lervo/context";
import { defaultKoreanWritingContract } from "@lervo/core";
import {
  ManagedProviderRunCoordinator,
  type ManagedFileChangeEvidence,
  type ManagedProviderResultArtifact,
} from "@lervo/orchestrator";
import { loadDocumentRegistry } from "@lervo/project";
import {
  openProjectStorage,
  type ProjectStorage,
} from "@lervo/project-storage";
import {
  evaluateWritingPublication,
  type WritingPublicationResult,
  type WritingSemanticEvaluator,
} from "@lervo/writing";

import { createDeveloperRole } from "./developer-role.js";
import { resolveRunSkills, type ResolvedRunSkill } from "./run-skills.js";

export type RunProvider = "codex" | "claude";

export interface ManagedRunRequest {
  repositoryRoot: string;
  provider: RunProvider;
  expectedPath: string;
  instructions: string;
  risk: string;
  skillIds?: readonly string[];
}

export interface ManagedRunOutcome {
  provider: RunProvider;
  projectId: string;
  runId: string;
  sessionId: string;
  resultArtifact: ManagedProviderResultArtifact;
  writingPublication: WritingPublicationResult;
  managedChanges: ManagedFileChangeEvidence[];
  verificationStatus: "not_run";
  resolvedSkills: readonly ResolvedRunSkill[];
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
  now?: () => Date;
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
};

export function createManagedRunExecutor(
  dependencies: ManagedRunDependencies = defaultDependencies,
): ExecuteManagedRun {
  return async (request) => {
    const expectedPath = normalizeRepositoryPath(request.expectedPath);
    const instructions = request.instructions.trim();
    const skillIds = [...new Set(request.skillIds ?? [])].sort();
    if (instructions.length === 0 || request.risk.trim().length === 0) {
      throw new TypeError("작업 문장과 위험도는 비어 있을 수 없습니다.");
    }

    let storage: ProjectStorage | undefined;
    let outcome: ManagedRunOutcome | undefined;
    let executionFailure: unknown;
    try {
      storage = await dependencies.openStorage(request.repositoryRoot);
      const registry = await loadDocumentRegistry(storage.paths.repositoryRoot);
      const role = createDeveloperRole(skillIds);
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
      });
      const result = await coordinator.run({
        repositoryRoot: storage.paths.repositoryRoot,
        requestDigest: digest(instructions),
        risk: request.risk.trim(),
        instructions,
        targetTurnId: dependencies.createId("turn"),
        context: {
          registry,
          role,
          expectedPaths: [expectedPath],
          documentRules: {},
          publications: [],
          handoffs: [],
          createReceiptId: () => dependencies.createId("ctx"),
        },
        writingPolicy: null,
        resolvedSkills,
        createEnvelopeId: () => dependencies.createId("envelope"),
        createEvidenceReceiptId: () => dependencies.createId("ctx"),
      });
      const writingPublication = await evaluateWritingPublication(
        {
          artifact: result.resultArtifact,
          contract: defaultKoreanWritingContract,
          surface: "chat",
          artifactStore: storage.artifacts,
          ...(dependencies.semanticEvaluator === undefined
            ? {}
            : { semanticEvaluator: dependencies.semanticEvaluator }),
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
        verificationStatus: "not_run",
        resolvedSkills,
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
          ? "Managed run 뒤 project storage를 닫지 못했습니다."
          : "Managed run 실패 뒤 project storage도 닫지 못했습니다.",
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
      throw new TypeError("Managed run 결과가 없습니다.");
    }
    return outcome;
  };
}

export const executeManagedRun = createManagedRunExecutor();
