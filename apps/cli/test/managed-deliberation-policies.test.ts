import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { defaultKoreanWritingContract } from "@lervo/core";
import {
  QueuedConversationDeliberationBackend,
  reconcileConversationDeliberation,
  runConversationDeliberationResumeWorkerCycle,
  runConversationDeliberationWorkerCycle,
} from "@lervo/conversation-control";
import {
  SQLiteConversationDeliberationJobStore,
  SQLiteConversationDeliberationResumeJobStore,
} from "@lervo/conversation-deliberation-sqlite";
import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import { createManagedConversationDeliberationExecutionAdapter } from
  "../src/conversation-deliberation-executor.js";
import { createManagedConversationDeliberationReconciliationSource } from
  "../src/conversation-deliberation-reconciliation.js";
import { createManagedConversationDeliberationResumeExecutionAdapter } from
  "../src/conversation-deliberation-resume-executor.js";
import { inspectManagedDeliberation } from "../src/deliberation-inspection.js";
import {
  createAssignedManagedDeliberationExecutor,
  createManagedDeliberationExecutor,
  DeliberationProcessInterruptedError,
} from "../src/managed-deliberation.js";
import { parseSemanticEvaluation } from "../src/managed-deliberation-runner.js";
import type { RunProvider } from "../src/managed-run.js";
import { runCli } from "../src/main.js";
import { prepareRunVerification } from "../src/run-verification.js";
import {
  cleanupManagedDeliberationFixtures,
  clock,
  FixtureDeliberationAdapter,
  repository,
  semanticPass,
  sequence,
  writeFourRolePolicy,
} from "./managed-deliberation-test-fixture.js";

afterEach(cleanupManagedDeliberationFixtures);

describe("managed CLI deliberation policies", () => {
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
    const reconciled = await reconcileConversationDeliberation({
      store: replacementQueue,
      source: createManagedConversationDeliberationReconciliationSource({
        projects: [{ projectId: "prj_cli_deliberation", repositoryRoot: root }],
      }),
      projectId: "prj_cli_deliberation",
      deliberationId: replacement.deliberationId,
      now,
    });
    expect(reconciled).toMatchObject({
      status: "reconciled",
      summary: {
        deliberationId: started.deliberationId,
        status: "converged",
        artifactCount: 5,
      },
    });
    await expect(replacementQueue.inspect({
      projectId: "prj_cli_deliberation",
      deliberationId: replacement.deliberationId,
    })).resolves.toMatchObject({
      state: "settled",
      failureCode: null,
      reconciliation: {
        sourceKind: "managed_deliberation_inspection_v1",
        priorFailureCode: "deliberation_execution_uncertain",
      },
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
      operation: "start",
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
      reconciliation: null,
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
