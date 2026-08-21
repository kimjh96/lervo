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

describe("managed CLI deliberation resume", () => {
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

    const resumeDependencies = {
      openStorage: openProjectStorage,
      createId: nextId,
      now,
      runner,
    };
    const mismatchedResume = createManagedConversationDeliberationResumeExecutionAdapter({
      projects: [{ projectId: "prj_wrongproject1", repositoryRoot: root }],
      executeAssignedResume: createAssignedManagedDeliberationExecutor(resumeDependencies),
    });
    await expect(mismatchedResume.execute({
      operation: "resume",
      projectId: "prj_wrongproject1",
      sourceEventId: `cve_${"6".repeat(64)}`,
      deliberationId,
      requestHash: `sha256:${"5".repeat(64)}`,
      principalHash: `sha256:${"4".repeat(64)}`,
      requestedAt: now().toISOString(),
      state: "leased",
      attemptCount: 1,
      leaseExpiresAt: now().toISOString(),
      summary: null,
      failureCode: null,
      reconciliation: null,
    })).rejects.toMatchObject({ code: "deliberation_project_mismatch" });
    const resumeQueue = await SQLiteConversationDeliberationResumeJobStore.open({
      path: resolve(root, ".lervo/state/conversation-deliberation-resumes.sqlite"),
    });
    await resumeQueue.enqueue({
      projectId: "prj_cli_deliberation",
      sourceEventId: `cve_${"9".repeat(64)}`,
      deliberationId,
      requestHash: `sha256:${"8".repeat(64)}`,
      principalHash: `sha256:${"7".repeat(64)}`,
      requestedAt: now().toISOString(),
    });
    const resumeAdapter = createManagedConversationDeliberationResumeExecutionAdapter({
      projects: [{ projectId: "prj_cli_deliberation", repositoryRoot: root }],
      executeAssignedResume: createAssignedManagedDeliberationExecutor(resumeDependencies),
    });
    const resumedCycle = await runConversationDeliberationResumeWorkerCycle({
      store: resumeQueue,
      executor: resumeAdapter,
      workerId: "managed-conversation-resume-worker",
      now,
    });
    if (resumedCycle.status !== "settled") throw new Error("대화 숙의 재개 queue가 종료되지 않았습니다.");
    const result = resumedCycle.summary;

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
    resumeQueue.close();

    const resumed = createManagedDeliberationExecutor(resumeDependencies);
    await expect(resumed({ repositoryRoot: root, resumeDeliberationId: deliberationId }))
      .rejects.toThrow("snapshot");
  });

});
