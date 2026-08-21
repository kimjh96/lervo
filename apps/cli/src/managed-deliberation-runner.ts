import { createHash, randomUUID } from "node:crypto";

import type { ProviderAdapter } from "@lervo/adapter-contract";
import { ClaudeAdapter } from "@lervo/adapter-claude";
import { CodexAdapter } from "@lervo/adapter-codex";
import { ManagedProviderRunCoordinator } from "@lervo/orchestrator";
import type { ProjectStorage } from "@lervo/project-storage";
import type { RoleProfile, VerificationSuite } from "@lervo/schemas";
import type { ManagedProviderRunResult } from "@lervo/orchestrator";
import type {
  SemanticWritingEvaluationRequest,
  SemanticWritingEvaluationResponse,
  WritingSemanticEvaluator,
} from "@lervo/writing";

import { createDeliberationEvaluatorRole } from "./deliberation-roles.js";
import type { DeliberationWorkspace } from "./deliberation-workspace.js";
import type { RunProvider } from "./managed-run.js";
import {
  prepareRunVerification,
  type PreparedRunVerification,
} from "./run-verification.js";

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function defaultId(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export interface ManagedDeliberationRunnerDependencies {
  createAdapter(input: {
    provider: RunProvider;
    repositoryRoot: string;
    resolveArtifact: (uri: string) => Promise<Uint8Array>;
  }): ProviderAdapter;
  createId(prefix: string): string;
  now(): Date;
  prepareVerification(input: {
    repositoryRoot: string;
    suiteIds: readonly string[];
    artifactStore: ProjectStorage["artifacts"];
    now?: () => Date;
  }): Promise<PreparedRunVerification>;
}

const defaultDependencies: ManagedDeliberationRunnerDependencies = {
  createAdapter: ({ provider, repositoryRoot, resolveArtifact }) =>
    provider === "codex"
      ? new CodexAdapter({ repositoryRoot, resolveArtifact })
      : new ClaudeAdapter({ repositoryRoot, resolveArtifact }),
  createId: defaultId,
  now: () => new Date(),
  prepareVerification: prepareRunVerification,
};

export interface ManagedDeliberationRunResult {
  run: ManagedProviderRunResult;
  content: string;
  verificationSuite?: VerificationSuite;
}

export class ManagedDeliberationRunner {
  constructor(
    private readonly storage: ProjectStorage,
    private readonly workspace: DeliberationWorkspace,
    private readonly policyVersion: string,
    private readonly defaultVerificationSuiteId: string,
    private readonly dependencies: ManagedDeliberationRunnerDependencies = defaultDependencies,
  ) {}

  async execute(input: {
    provider: RunProvider;
    role: RoleProfile;
    instructions: string;
    documentRules: Record<string, string[]>;
    verificationSuiteId?: string;
  }): Promise<ManagedDeliberationRunResult> {
    const repositoryRoot = this.storage.paths.repositoryRoot;
    const verification = input.verificationSuiteId === undefined
      ? undefined
      : await this.dependencies.prepareVerification({
        repositoryRoot,
        suiteIds: [input.verificationSuiteId],
        artifactStore: this.storage.artifacts,
        now: this.dependencies.now,
      });
    const runId = this.dependencies.createId("run");
    const sessionId = this.dependencies.createId("ses");
    const adapter = this.dependencies.createAdapter({
      provider: input.provider,
      repositoryRoot,
      resolveArtifact: (uri) => this.storage.artifacts.get(uri),
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
      createEventId: () => this.dependencies.createId("evt"),
      ...(verification === undefined ? {} : { projectVerifier: verification.verifier }),
      now: this.dependencies.now,
    });
    const humanPresentation = input.role.outputContract.presentation.audience !== "machine";
    const run = await coordinator.run({
      repositoryRoot,
      requestDigest: digest(input.instructions),
      risk: "medium",
      instructions: input.instructions,
      targetTurnId: this.dependencies.createId("turn"),
      context: {
        registry: this.workspace.registry(),
        role: input.role,
        expectedPaths: [],
        documentRules: input.documentRules,
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
      ...(verification === undefined ? {} : { verificationSuites: verification.suites }),
      createEnvelopeId: () => this.dependencies.createId("envelope"),
      createEvidenceReceiptId: () => this.dependencies.createId("ctx"),
    });
    const bytes = await this.storage.artifacts.get(run.resultArtifact.uri);
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (bytes.byteLength !== run.resultArtifact.byteCount || digest(content) !== run.resultArtifact.contentHash) {
      throw new Error("숙의 provider 결과의 CAS 좌표가 원문과 다릅니다.");
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
      evaluate: async (request) => this.evaluateSemantics(provider, request),
    };
  }

  private async evaluateSemantics(
    provider: RunProvider,
    request: SemanticWritingEvaluationRequest,
  ): Promise<SemanticWritingEvaluationResponse> {
    const requestDocument = `${JSON.stringify({
      schemaVersion: 1,
      writingPolicyId: request.writingPolicyId,
      locale: request.locale,
      surface: request.surface,
      artifactId: request.artifactId,
      contentHash: request.contentHash,
      content: request.content,
      checks: request.checks,
    }, null, 2)}\n`;
    const documentId = await this.workspace.materializeSemanticEvaluationRequest(
      requestDocument,
    );
    const role = createDeliberationEvaluatorRole(this.defaultVerificationSuiteId);
    const result = await this.execute({
      provider,
      role,
      instructions: [
        "writing.evaluation.request 문서의 한국어 문장과 검사 조건을 별도로 평가하세요.",
        "응답은 설명이나 Markdown code fence 없이 JSON 객체 하나만 작성하세요.",
        "형식: {\"checks\":[{\"checkId\":\"...\",\"status\":\"passed|failed\",\"violationCount\":0}]}",
        "요청의 check 순서를 유지하고 빠짐없이 판정하세요.",
      ].join("\n"),
      documentRules: { "writing.evaluation.request": [documentId] },
    });
    return parseSemanticEvaluation(result.content, request, provider);
  }
}

export function parseSemanticEvaluation(
  content: string,
  request: SemanticWritingEvaluationRequest,
  provider: RunProvider,
): SemanticWritingEvaluationResponse {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error("Writing 의미 평가 결과가 JSON 객체가 아닙니다.");
  }
  if (
    value === null || typeof value !== "object" || Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["checks"])
  ) throw new Error("Writing 의미 평가 결과의 필드가 올바르지 않습니다.");
  const checks = (value as { checks?: unknown }).checks;
  if (!Array.isArray(checks) || checks.length !== request.checks.length) {
    throw new Error("Writing 의미 평가 결과가 필수 검사를 모두 포함하지 않습니다.");
  }
  const normalized = checks.map((check, index) => {
    if (
      check === null || typeof check !== "object" || Array.isArray(check) ||
      JSON.stringify(Object.keys(check).sort()) !==
        JSON.stringify(["checkId", "status", "violationCount"].sort())
    ) throw new Error("Writing 의미 평가 검사 형식이 올바르지 않습니다.");
    const item = check as { checkId?: unknown; status?: unknown; violationCount?: unknown };
    const expected = request.checks[index]!;
    if (
      item.checkId !== expected.checkId ||
      (item.status !== "passed" && item.status !== "failed") ||
      !Number.isInteger(item.violationCount) || Number(item.violationCount) < 0 ||
      (item.status === "passed" && item.violationCount !== 0) ||
      (item.status === "failed" && item.violationCount === 0)
    ) throw new Error("Writing 의미 평가 검사 좌표나 판정이 올바르지 않습니다.");
    const status: "passed" | "failed" = item.status;
    return {
      checkId: expected.checkId,
      status,
      violationCount: Number(item.violationCount),
    };
  });
  return {
    evaluator: {
      kind: "model",
      evaluatorId: `lervo.${provider}.semantic-writing.v1`,
    },
    checks: normalized,
  };
}
