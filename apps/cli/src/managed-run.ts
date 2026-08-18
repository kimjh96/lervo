import { createHash, randomUUID } from "node:crypto";

import type { ProviderAdapter } from "@roven/adapter-contract";
import { ClaudeAdapter } from "@roven/adapter-claude";
import { CodexAdapter } from "@roven/adapter-codex";
import { normalizeRepositoryPath } from "@roven/context";
import {
  ManagedProviderRunCoordinator,
  type ManagedFileChangeEvidence,
  type ManagedProviderResultArtifact,
} from "@roven/orchestrator";
import { loadDocumentRegistry } from "@roven/project";
import {
  openProjectStorage,
  type ProjectStorage,
} from "@roven/project-storage";
import type { RoleProfile } from "@roven/schemas";

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
  resultContent: string;
  managedChanges: ManagedFileChangeEvidence[];
  verificationStatus: "not_run";
  writingVerificationStatus: "not_run";
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
  now?: () => Date;
}

export type ExecuteManagedRun = (request: ManagedRunRequest) => Promise<ManagedRunOutcome>;

export class ManagedRunCommandError extends Error {
  constructor(
    readonly code: "cleanup_failed" | "result_decode_failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ManagedRunCommandError";
  }
}

const developerRoleBase: RoleProfile = {
  schemaVersion: 1,
  roleId: "developer",
  name: "Developer",
  description: "저장소 지침을 읽고 선언된 한 파일을 변경합니다.",
  requestTypes: ["implementation"],
  requiredInputs: [],
  contextPolicy: {
    requiredDocumentRuleIds: ["repository.instructions"],
    minimumAssurance: "E3",
    referencesRequired: true,
  },
  capabilities: {
    "filesystem.read": "allow",
    "filesystem.write": "allow",
    "shell.execute": "allow",
    "network.access": "deny",
    "external.message": "deny",
    deploy: "deny",
    "data.mutate": "deny",
  },
  defaultSkills: [],
  outputContract: {
    artifactKind: "source_code",
    schemaRef: "roven-schema://run/source-code/v1",
    pathTemplate: "{expectedPath}",
    citationsRequired: false,
    presentation: { audience: "machine", writingPolicyId: null },
  },
  verification: {
    suiteIds: ["roven.v0.not_run"],
    failureDisposition: "fail_run",
  },
  handoff: {
    allowedRoleIds: [],
    evidenceLinksRequired: true,
    sharedContextRequired: true,
  },
};

function developerRole(skillIds: readonly string[]): RoleProfile {
  return { ...structuredClone(developerRoleBase), defaultSkills: [...skillIds] };
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

function decodeResult(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new ManagedRunCommandError(
      "result_decode_failed",
      "저장된 provider 결과를 UTF-8로 읽을 수 없습니다.",
      { cause: error },
    );
  }
}

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
      const role = developerRole(skillIds);
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
      const resultContent = decodeResult(
        await storage.artifacts.get(result.resultArtifact.uri),
      );
      outcome = {
        provider: request.provider,
        projectId: storage.manifest.projectId,
        runId,
        sessionId,
        resultArtifact: result.resultArtifact,
        resultContent,
        managedChanges: result.managedChanges,
        verificationStatus: "not_run",
        writingVerificationStatus: "not_run",
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
