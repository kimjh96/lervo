import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  createAdapterTurnResult,
  type ProviderAdapter,
  type ProviderManagedWriteBridge,
} from "@lervo/adapter-contract";
import { defaultKoreanWritingContract } from "@lervo/core";
import {
  QueuedConversationDeliberationBackend,
  runConversationDeliberationWorkerCycle,
} from "@lervo/conversation-control";
import { SQLiteConversationDeliberationJobStore } from "@lervo/conversation-deliberation-sqlite";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { openProjectStorage } from "@lervo/project-storage";
import type {
  AdapterContextEnvelope,
  AdapterContextReceipt,
  AdapterDescriptor,
  AdapterNormalizedEvent,
  AdapterSession,
  AdapterStartRequest,
  AdapterStopRequest,
  AdapterTurn,
  AdapterTurnRequest,
  AdapterTurnResult,
} from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import {
  createAssignedManagedDeliberationExecutor,
  createManagedDeliberationExecutor,
  DeliberationProcessInterruptedError,
} from "../src/managed-deliberation.js";
import { createManagedConversationDeliberationExecutionAdapter } from "../src/conversation-deliberation-executor.js";
import type { RunProvider } from "../src/managed-run.js";
import { inspectManagedDeliberation } from "../src/deliberation-inspection.js";
import { runCli } from "../src/main.js";
import { prepareRunVerification } from "../src/run-verification.js";
import { parseSemanticEvaluation } from "../src/managed-deliberation-runner.js";

const roots: string[] = [];

function semanticPass(): string {
  return JSON.stringify({
    checks: defaultKoreanWritingContract.verification.semanticChecks.map((check) => ({
      checkId: check.checkId,
      status: "passed",
      violationCount: 0,
    })),
  });
}

class FixtureDeliberationAdapter implements ProviderAdapter {
  readonly descriptor: AdapterDescriptor;
  private turn?: AdapterTurn;
  private release?: () => void;
  private readonly started = new Promise<void>((resolveStarted) => {
    this.release = resolveStarted;
  });

  constructor(
    private readonly provider: RunProvider,
    private readonly providerSessionId: string,
    private readonly content: string,
    private readonly receiptId: string,
  ) {
    this.descriptor = {
      kind: "descriptor",
      schemaVersion: 1,
      adapterId: `lervo/${provider}`,
      adapterVersion: "fixture-1",
      provider,
      capabilities: {
        controlledContextInjection: "supported",
        toolCalls: "unsupported",
        commandExecution: "unsupported",
        fileChanges: "unsupported",
        contextCompaction: "unsupported",
        sessionResume: "unsupported",
        usage: "unknown",
      },
    };
  }

  async start(request: AdapterStartRequest): Promise<AdapterSession> {
    return {
      kind: "session",
      schemaVersion: 1,
      adapterId: this.descriptor.adapterId,
      projectId: request.projectId,
      runId: request.runId,
      sessionId: request.sessionId,
      roleId: request.roleId,
      writingPolicyId: request.writingPolicyId,
      provider: this.provider,
      providerSessionId: this.providerSessionId,
      executionMode: request.executionMode,
      effectiveCapabilities: this.descriptor.capabilities,
      startedAt: request.requestedAt,
    };
  }

  async injectContext(
    session: AdapterSession,
    envelope: AdapterContextEnvelope,
  ): Promise<AdapterContextReceipt> {
    return {
      kind: "context_receipt",
      schemaVersion: 1,
      receiptId: this.receiptId,
      envelopeId: envelope.envelopeId,
      adapterId: session.adapterId,
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      roleId: session.roleId,
      writingPolicyId: session.writingPolicyId,
      writingPolicyDocumentId: envelope.writingPolicyDocumentId,
      provider: session.provider,
      providerSessionId: session.providerSessionId,
      targetTurnId: envelope.targetTurnId,
      contextGeneration: envelope.contextGeneration,
      controlledInput: true,
      documents: envelope.documents.map((document) => ({
        documentId: document.documentId,
        contentHash: document.contentHash,
        scope: document.scope,
        status: "injected" as const,
      })),
      acceptedAt: envelope.createdAt,
    };
  }

  async attachManagedWriteBridge(
    _session: AdapterSession,
    _bridge: ProviderManagedWriteBridge,
  ): Promise<void> {}

  async startTurn(
    _session: AdapterSession,
    request: AdapterTurnRequest,
    accepted: (turn: AdapterTurn) => void,
  ): Promise<AdapterTurn> {
    this.turn = {
      kind: "turn",
      schemaVersion: 1,
      adapterId: request.adapterId,
      projectId: request.projectId,
      runId: request.runId,
      sessionId: request.sessionId,
      providerSessionId: request.providerSessionId,
      targetTurnId: request.targetTurnId,
      providerTurnId: `provider-${request.targetTurnId}`,
      acceptedAt: request.requestedAt,
    };
    accepted(structuredClone(this.turn));
    this.release?.();
    return structuredClone(this.turn);
  }

  async *events(
    session: AdapterSession,
    signal: AbortSignal,
  ): AsyncIterable<AdapterNormalizedEvent> {
    await Promise.race([
      this.started,
      new Promise<void>((resolveAbort) =>
        signal.addEventListener("abort", () => resolveAbort(), { once: true })),
    ]);
    if (signal.aborted || this.turn === undefined) return;
    yield {
      kind: "normalized_event",
      schemaVersion: 1,
      eventId: `evt_provider_${this.receiptId.slice(4)}`,
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      type: "provider.turn.completed",
      occurredAt: this.turn.acceptedAt,
      payload: {
        providerTurnId: this.turn.providerTurnId,
        status: "completed",
        durationMs: 1,
      },
    };
  }

  async getTurnResult(session: AdapterSession, turn: AdapterTurn): Promise<AdapterTurnResult> {
    return createAdapterTurnResult({
      session,
      turn,
      content: this.content,
      producedAt: turn.acceptedAt,
    });
  }

  async stop(session: AdapterSession, request: AdapterStopRequest) {
    return {
      kind: "stop_result" as const,
      schemaVersion: 1 as const,
      adapterId: session.adapterId,
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      status: request.reason,
      stoppedAt: request.requestedAt,
    };
  }
}

function sequence() {
  let value = 0;
  return (prefix: string) => `${prefix}_${String(++value).padStart(16, "0")}`;
}

function clock() {
  let value = Date.parse("2026-08-21T00:00:00Z");
  return () => {
    const current = new Date(value);
    value += 1_000;
    return current;
  };
}

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-cli-deliberation-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({
    root,
    projectId: "prj_cli_deliberation",
    now: new Date("2026-08-21T00:00:00Z"),
  }));
  await mkdir(resolve(root, "src"));
  await writeFile(
    resolve(root, "AGENTS.md"),
    "저장소 근거를 확인하고 자연스러운 한국어 문단으로 답합니다.\n",
  );
  await writeFile(
    resolve(root, ".lervo/verifications/project.default.yaml"),
    [
      "schemaVersion: 1",
      "suiteId: project.default",
      "stopOnFailure: true",
      "commands:",
      "  - commandId: verify-project",
      "    executable: node",
      "    arguments:",
      "      - -e",
      "      - process.exit(0)",
      "    cwd: .",
      "    timeoutMs: 10000",
      "    maxOutputBytes: 4096",
      "    environmentVariableNames: []",
      "",
    ].join("\n"),
  );
  return root;
}

async function writeFourRolePolicy(root: string): Promise<void> {
  await writeFile(
    resolve(root, ".lervo/deliberations/deliberation_product-review.yaml"),
    [
      "schemaVersion: 1",
      "policyId: deliberation_product-review",
      "maxRounds: 2",
      "requiredVerificationSuiteIds:",
      "  - project.default",
      "participants:",
      "  - roleId: product-planner",
      "    name: 제품 기획자",
      "    description: 사용자 가치와 적용 범위를 중심으로 제안을 작성합니다.",
      "    provider: codex",
      "    responsibilities: [proposer, decision_owner]",
      "  - roleId: maintainability-reviewer",
      "    name: 유지보수 검토자",
      "    description: 관심사 분리와 장기 변경 비용을 독립적으로 검토합니다.",
      "    provider: claude",
      "    responsibilities: [reviewer]",
      "  - roleId: evidence-reviewer",
      "    name: 증거 검토자",
      "    description: 주장과 저장소 근거의 연결이 충분한지 독립적으로 검토합니다.",
      "    provider: codex",
      "    responsibilities: [reviewer]",
      "  - roleId: project-verifier",
      "    name: 프로젝트 검증자",
      "    description: 실제 검증 결과와 결론의 범위를 확인합니다.",
      "    provider: claude",
      "    responsibilities: [verifier]",
      "",
    ].join("\n"),
  );
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("managed CLI deliberation", () => {
  it("accepts only an exact, complete semantic writing evaluation", () => {
    const request = {
      writingPolicyId: defaultKoreanWritingContract.writingPolicyId,
      locale: "ko-KR",
      surface: "chat" as const,
      artifactId: "art_semantic_input_0001",
      contentHash: `sha256:${"1".repeat(64)}`,
      content: "검토할 한국어 문장입니다.",
      checks: defaultKoreanWritingContract.verification.semanticChecks,
    };
    expect(parseSemanticEvaluation(semanticPass(), request, "claude").checks)
      .toHaveLength(request.checks.length);
    expect(() => parseSemanticEvaluation(
      `\`\`\`json\n${semanticPass()}\n\`\`\``,
      request,
      "claude",
    )).toThrow("JSON 객체가 아닙니다");
    expect(() => parseSemanticEvaluation(
      JSON.stringify({ checks: JSON.parse(semanticPass()).checks.slice(1) }),
      request,
      "claude",
    )).toThrow("필수 검사를 모두 포함하지 않습니다");
  });

  it("converges through independent Codex and Claude sessions with real verification", async () => {
    const root = await repository();
    const pass = semanticPass();
    const queues: Record<RunProvider, string[]> = {
      codex: [
        "제안은 역할마다 같은 저장소 근거를 별도 세션에서 읽는 방식입니다. 각 기록은 검증 결과와 연결합니다.",
        pass,
        pass,
        "결론은 독립 세션과 별도 맥락 증거를 유지하는 것입니다. 프로젝트 검증도 통과했으므로 이 범위로 적용합니다.",
      ],
      claude: [
        pass,
        "판정: 승인\n\n제안은 역할별 세션과 맥락 증거를 분리했습니다. 현재 검토 범위에서는 차단할 문제가 없습니다.",
        "프로젝트 검증은 저장소의 실제 명령을 별도로 실행합니다. 통과 결과는 현재 제안의 근거로만 사용합니다.",
        pass,
      ],
    };
    const nextId = sequence();
    const now = clock();
    const executor = createManagedDeliberationExecutor({
      openStorage: openProjectStorage,
      createId: nextId,
      now,
      runner: {
        createAdapter: ({ provider }) => {
          const content = queues[provider].shift();
          if (content === undefined) throw new Error(`${provider} fixture 응답이 없습니다.`);
          return new FixtureDeliberationAdapter(
            provider,
            `provider-session-${nextId("session")}`,
            content,
            nextId("ctx"),
          );
        },
        createId: nextId,
        now,
        prepareVerification: prepareRunVerification,
      },
    });
    const result = await executor({
      repositoryRoot: root,
      proposerProvider: "codex",
      reviewerProvider: "claude",
      verificationSuiteIds: ["project.default"],
      topic: "두 공급자가 같은 맥락을 독립적으로 검토하는 방식을 결정합니다.",
    });

    expect(result.status).toBe("converged");
    expect(result.artifactCount).toBe(4);
    expect(queues).toEqual({ codex: [], claude: [] });
    const storage = await openProjectStorage(root);
    const events = storage.events.list({ limit: 1000 });
    expect(events.filter((event) => event.type === "deliberation.artifact.recorded"))
      .toHaveLength(4);
    expect(events.filter((event) => event.type === "context.published")).toHaveLength(4);
    expect(events.filter((event) => event.type === "handoff.created")).toHaveLength(8);
    expect(events.filter((event) => event.type === "verification.completed")).toHaveLength(1);
    expect(events.filter((event) => event.type === "deliberation.completed")[0]?.payload)
      .toMatchObject({ status: "converged" });
    const sessions = events
      .filter((event) => event.type === "adapter.started")
      .map((event) => event.payload.providerSessionId);
    expect(new Set(sessions).size).toBe(8);
    expect(JSON.stringify(events)).not.toContain(result.finalContent);
    expect(storage.events.verifyIntegrity().valid).toBe(true);
    await storage.close();

    const deliberationRoots = await readdir(resolve(root, ".lervo/state/deliberations"));
    expect(deliberationRoots).toHaveLength(1);
    const entries = await readdir(
      resolve(root, ".lervo/state/deliberations", deliberationRoots[0]!),
    );
    expect(entries.filter((entry) => entry.startsWith("artifact-"))).toHaveLength(4);
  });

  it("resumes from the immutable approved boundary without repeating proposal or review", async () => {
    const root = await repository();
    const pass = semanticPass();
    const queues: Record<RunProvider, string[]> = {
      codex: [
        "제안은 승인된 검토까지 원본과 실행 증거를 보존하고, 그 경계에서만 안전하게 재개하는 방식입니다.",
        pass,
        pass,
        "결론은 승인 경계를 다시 검증한 뒤 검증과 결정 단계만 이어가는 것입니다.",
      ],
      claude: [
        pass,
        "판정: 승인\n\n승인 이전 산출물과 이벤트를 다시 확인하므로 중복 실행 없이 이어갈 수 있습니다.",
        "프로젝트 검증은 재개 뒤 실제 명령으로 새로 실행했으며 현재 저장소에서 통과했습니다.",
        pass,
      ],
    };
    const nextId = sequence();
    const now = clock();
    const runner = {
      createAdapter: ({ provider }: { provider: RunProvider }) => {
        const content = queues[provider].shift();
        if (content === undefined) throw new Error(`${provider} fixture 응답이 없습니다.`);
        return new FixtureDeliberationAdapter(
          provider,
          `provider-session-${nextId("session")}`,
          content,
          nextId("ctx"),
        );
      },
      createId: nextId,
      now,
      prepareVerification: prepareRunVerification,
    };
    let deliberationId = "";
    let concurrentResumeBlocked = false;
    const interrupted = createManagedDeliberationExecutor({
      openStorage: openProjectStorage,
      createId: nextId,
      now,
      runner,
      afterApprovedCheckpoint: async (id) => {
        deliberationId = id;
        const inspecting = await openProjectStorage(root);
        const active = await inspectManagedDeliberation({
          storage: inspecting,
          deliberationId: id,
        });
        expect(active).toMatchObject({
          phase: "running_after_approval",
          lease: "active",
          resume: "blocked_running",
        });
        await inspecting.close();
        const contender = createManagedDeliberationExecutor({
          openStorage: openProjectStorage,
          createId: nextId,
          now,
          runner,
        });
        try {
          await contender({ repositoryRoot: root, resumeDeliberationId: id });
        } catch (error) {
          concurrentResumeBlocked = (error as { code?: unknown }).code ===
            "deliberation_in_progress";
        }
        throw new DeliberationProcessInterruptedError("fixture interruption");
      },
    });

    await expect(interrupted({
      repositoryRoot: root,
      proposerProvider: "codex",
      reviewerProvider: "claude",
      verificationSuiteIds: ["project.default"],
      topic: "승인된 검토 다음 단계에서 중단된 숙의를 재개합니다.",
    })).rejects.toThrow("fixture interruption");
    expect(concurrentResumeBlocked).toBe(true);

    const before = await openProjectStorage(root);
    const beforeEvents = before.events.list({ limit: 1000 });
    expect(beforeEvents.filter((event) => event.type === "deliberation.artifact.recorded"))
      .toHaveLength(2);
    expect(beforeEvents.some((event) => event.type === "deliberation.completed")).toBe(false);
    expect(await inspectManagedDeliberation({ storage: before, deliberationId })).toMatchObject({
      sourceStatus: "consistent",
      phase: "interrupted_after_approval",
      checkpoint: "readable",
      lease: "missing",
      resume: "candidate",
    });
    await before.close();

    let traceOutput = "";
    expect(await runCli(["trace", "--deliberation", deliberationId], {
      cwd: root,
      stdout: (message) => { traceOutput += message; },
      stderr: () => undefined,
    })).toBe(0);
    expect(traceOutput).toContain("승인 뒤 재개 가능 후보");
    expect(traceOutput).toContain("deliberation.artifact.recorded");

    let doctorOutput = "";
    expect(await runCli(["doctor", "--deliberation", deliberationId], {
      cwd: root,
      stdout: (message) => { doctorOutput += message; },
      stderr: () => undefined,
    })).toBe(0);
    expect(doctorOutput).toContain("실제 재개 시 전체 원본 재검증 필요");

    let statusOutput = "";
    expect(await runCli(["deliberate", "status", deliberationId], {
      cwd: root,
      stdout: (message) => { statusOutput += message; },
      stderr: () => undefined,
    })).toBe(0);
    expect(statusOutput).toContain("승인 뒤 재개 가능 후보");

    const resumed = createManagedDeliberationExecutor({
      openStorage: openProjectStorage,
      createId: nextId,
      now,
      runner,
    });
    const result = await resumed({ repositoryRoot: root, resumeDeliberationId: deliberationId });

    expect(result).toMatchObject({ deliberationId, status: "converged", artifactCount: 4 });
    expect(queues).toEqual({ codex: [], claude: [] });
    const after = await openProjectStorage(root);
    const events = after.events.list({ limit: 1000 });
    expect(events.filter((event) => event.type === "deliberation.started")).toHaveLength(1);
    expect(events.filter((event) => event.type === "deliberation.artifact.recorded"))
      .toHaveLength(4);
    expect(events.filter((event) => event.type === "verification.completed")).toHaveLength(1);
    expect(events.filter((event) => event.type === "deliberation.completed")).toHaveLength(1);
    expect(after.events.verifyIntegrity().valid).toBe(true);
    expect(await inspectManagedDeliberation({ storage: after, deliberationId })).toMatchObject({
      sourceStatus: "consistent",
      phase: "completed",
      completionStatus: "converged",
      resume: "completed",
    });
    await after.close();

    await expect(resumed({ repositoryRoot: root, resumeDeliberationId: deliberationId }))
      .rejects.toThrow("snapshot");
  });

  it("runs every role in a stored four-role policy with separate context evidence", async () => {
    const root = await repository();
    await writeFourRolePolicy(root);
    const pass = semanticPass();
    const queues: Record<RunProvider, string[]> = {
      codex: [
        "제안은 사용자 가치와 적용 범위를 먼저 정하고 각 검토 근거를 별도 기록으로 연결하는 것입니다.",
        pass,
        "판정: 승인\n\n저장소 근거와 주장의 연결이 분명하며 현재 범위에서 추가로 차단할 문제는 없습니다.",
        pass,
        "결론은 네 역할의 독립 세션과 실제 검증 결과를 함께 보존하는 방식입니다. 적용 범위도 명확합니다.",
      ],
      claude: [
        pass,
        "판정: 승인\n\n관심사가 역할과 실행 단계별로 나뉘어 있으며 장기 변경 비용을 키우는 차단 문제는 없습니다.",
        pass,
        "프로젝트 검증은 실제 명령 결과와 현재 저장소 revision에 연결됩니다. 통과 범위 밖의 사실은 주장하지 않습니다.",
        pass,
      ],
    };
    const nextId = sequence();
    const now = clock();
    const executor = createAssignedManagedDeliberationExecutor({
      openStorage: openProjectStorage,
      createId: nextId,
      now,
      runner: {
        createAdapter: ({ provider }) => new FixtureDeliberationAdapter(
          provider,
          `provider-session-${nextId("session")}`,
          queues[provider].shift() ?? "",
          nextId("ctx"),
        ),
        createId: nextId,
        now,
        prepareVerification: prepareRunVerification,
      },
    });

    const adapter = createManagedConversationDeliberationExecutionAdapter({
      projects: [{ projectId: "prj_cli_deliberation", repositoryRoot: root }],
      executeAssigned: executor,
    });
    const queue = await SQLiteConversationDeliberationJobStore.open({
      path: resolve(root, ".lervo/state/conversation-deliberations.sqlite"),
    });
    const backend = new QueuedConversationDeliberationBackend(queue);
    const started = await backend.start({
      projectId: "prj_cli_deliberation",
      principalId: "operator:reviewer",
      sourceEventId: `cve_${"a".repeat(64)}`,
      policyId: "deliberation_product-review",
      topic: "여러 전문 역할이 같은 공개 근거를 각자 확인하는 방식을 결정합니다.",
      requestedAt: "2026-08-21T00:00:00.000Z",
    });
    const cycle = await runConversationDeliberationWorkerCycle({
      store: queue,
      executor: adapter,
      workerId: "managed-conversation-worker",
      now,
    });
    if (cycle.status !== "settled") throw new Error("대화 숙의 queue가 종료되지 않았습니다.");
    const result = cycle.summary;

    expect(result.deliberationId).toBe(started.deliberationId);
    expect(result.status).toBe("converged");
    expect(result.artifactCount).toBe(5);
    expect(queues).toEqual({ codex: [], claude: [] });
    const storage = await openProjectStorage(root);
    const events = storage.events.list({ limit: 1000 });
    expect(events.filter((event) => event.type === "context.published")).toHaveLength(5);
    expect(events.filter((event) => event.type === "handoff.created")).toHaveLength(20);
    expect(events.filter((event) => event.type === "verification.completed")).toHaveLength(1);
    const sessions = events
      .filter((event) => event.type === "adapter.started")
      .map((event) => event.payload.providerSessionId);
    expect(new Set(events.flatMap((event) => event.type === "run.requested" &&
      event.payload.role !== "deliberation-writing-evaluator"
      ? [event.payload.role]
      : []))).toEqual(new Set([
      "product-planner",
      "maintainability-reviewer",
      "evidence-reviewer",
      "project-verifier",
    ]));
    expect(sessions).toHaveLength(10);
    expect(new Set(sessions).size).toBe(10);
    expect(storage.events.verifyIntegrity().valid).toBe(true);
    await storage.close();
    await expect(backend.start({
      projectId: "prj_cli_deliberation",
      principalId: "operator:reviewer",
      sourceEventId: `cve_${"a".repeat(64)}`,
      policyId: "deliberation_product-review",
      topic: "여러 전문 역할이 같은 공개 근거를 각자 확인하는 방식을 결정합니다.",
      requestedAt: "2026-08-21T00:00:00.000Z",
    })).resolves.toMatchObject({
      deliberationId: started.deliberationId,
      status: "converged",
    });
    queue.close();
    const replacementQueue = await SQLiteConversationDeliberationJobStore.open({
      path: resolve(root, ".lervo/state/replacement-conversation-deliberations.sqlite"),
    });
    const replacementBackend = new QueuedConversationDeliberationBackend(replacementQueue);
    const replacement = await replacementBackend.start({
      projectId: "prj_cli_deliberation",
      principalId: "operator:reviewer",
      sourceEventId: `cve_${"a".repeat(64)}`,
      policyId: "deliberation_product-review",
      topic: "여러 전문 역할이 같은 공개 근거를 각자 확인하는 방식을 결정합니다.",
      requestedAt: "2026-08-21T00:00:00.000Z",
    });
    expect(replacement.deliberationId).toBe(started.deliberationId);
    await expect(runConversationDeliberationWorkerCycle({
      store: replacementQueue,
      executor: adapter,
      workerId: "replacement-managed-worker",
      now,
    })).resolves.toMatchObject({
      status: "uncertain",
      deliberationId: started.deliberationId,
    });
    replacementQueue.close();
    const unchanged = await openProjectStorage(root);
    expect(unchanged.events.list({ limit: 1000 })
      .filter((event) => event.type === "deliberation.started")).toHaveLength(1);
    expect(unchanged.events.verifyIntegrity().valid).toBe(true);
    await unchanged.close();
    const mismatchedProject = createManagedConversationDeliberationExecutionAdapter({
      projects: [{ projectId: "prj_wrongproject1", repositoryRoot: root }],
      executeAssigned: executor,
    });
    await expect(mismatchedProject.execute({
      projectId: "prj_wrongproject1",
      sourceEventId: `cve_${"d".repeat(64)}`,
      deliberationId: `dlb_${"e".repeat(32)}`,
      requestHash: `sha256:${"f".repeat(64)}`,
      principalHash: `sha256:${"1".repeat(64)}`,
      policyId: "deliberation_product-review",
      topic: "잘못 연결된 저장소에서는 provider를 시작하지 않습니다.",
      requestedAt: "2026-08-21T00:11:00.000Z",
      state: "leased",
      attemptCount: 1,
      leaseExpiresAt: "2026-08-21T00:16:00.000Z",
      summary: null,
      failureCode: null,
    })).rejects.toMatchObject({ code: "deliberation_project_mismatch" });
  });

  it("stops as no_consensus after the second blocking review", async () => {
    const root = await repository();
    const pass = semanticPass();
    const queues: Record<RunProvider, string[]> = {
      codex: [
        "첫 제안은 저장소 맥락을 역할별로 다시 읽는 것입니다. 각 역할은 독립된 실행 기록을 남깁니다.",
        pass,
        "수정안은 각 역할의 별도 receipt를 필수로 확인합니다. 검토 결과도 다음 역할의 입력으로 연결합니다.",
        pass,
      ],
      claude: [
        pass,
        "판정: 수정 필요\n\n첫 제안은 검증 결과가 결론과 연결되는 방법을 설명하지 않아 지금 채택할 수 없습니다.",
        pass,
        "판정: 수정 필요\n\n수정안도 실패한 검증을 처리하는 기준이 없으므로 차단 반론이 남습니다.",
      ],
    };
    const nextId = sequence();
    const now = clock();
    const executor = createManagedDeliberationExecutor({
      openStorage: openProjectStorage,
      createId: nextId,
      now,
      runner: {
        createAdapter: ({ provider }) => new FixtureDeliberationAdapter(
          provider,
          `provider-session-${nextId("session")}`,
          queues[provider].shift() ?? "",
          nextId("ctx"),
        ),
        createId: nextId,
        now,
        prepareVerification: prepareRunVerification,
      },
    });
    const result = await executor({
      repositoryRoot: root,
      proposerProvider: "codex",
      reviewerProvider: "claude",
      verificationSuiteIds: ["project.default"],
      topic: "차단 반론이 남으면 결론으로 처리하지 않습니다.",
    });

    expect(result.status).toBe("no_consensus");
    expect(result.outcome).toMatchObject({
      status: "no_consensus",
      noConsensusReason: "blocking_objections_unresolved",
      decisionArtifactId: null,
    });
    const storage = await openProjectStorage(root);
    const events = storage.events.list({ limit: 1000 });
    expect(events.some((event) => event.type === "verification.started")).toBe(false);
    expect(events.filter((event) => event.type === "deliberation.completed")[0]?.payload)
      .toMatchObject({ status: "no_consensus" });
    await storage.close();
  });

  it("does not turn an unstructured reviewer sentence into approval", async () => {
    const root = await repository();
    const queues: Record<RunProvider, string[]> = {
      codex: [
        "제안은 공통 맥락을 역할마다 직접 확인하는 것입니다. 각 세션은 별도 증거를 기록합니다.",
      ],
      claude: [
        semanticPass(),
        "제안에 동의합니다. 이 문장은 구조화된 승인 표식을 따르지 않았습니다.",
      ],
    };
    const nextId = sequence();
    const now = clock();
    const executor = createManagedDeliberationExecutor({
      openStorage: openProjectStorage,
      createId: nextId,
      now,
      runner: {
        createAdapter: ({ provider }) => new FixtureDeliberationAdapter(
          provider,
          `provider-session-${nextId("session")}`,
          queues[provider].shift() ?? "",
          nextId("ctx"),
        ),
        createId: nextId,
        now,
        prepareVerification: prepareRunVerification,
      },
    });

    await expect(executor({
      repositoryRoot: root,
      proposerProvider: "codex",
      reviewerProvider: "claude",
      verificationSuiteIds: ["project.default"],
      topic: "자유 형식 문장을 승인으로 추정하지 않습니다.",
    })).rejects.toThrow("첫 문장은 '판정: 승인' 또는 '판정: 수정 필요'");

    const storage = await openProjectStorage(root);
    const events = storage.events.list({ limit: 1000 });
    expect(events.filter((event) => event.type === "deliberation.artifact.recorded"))
      .toHaveLength(1);
    expect(events.filter((event) => event.type === "deliberation.completed")[0]?.payload)
      .toMatchObject({ status: "failed", failureCode: "deliberation_failed" });
    expect(events.some((event) => event.type === "verification.started")).toBe(false);
    await storage.close();
  });
});
