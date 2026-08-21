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

describe("managed CLI deliberation convergence", () => {
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

});
