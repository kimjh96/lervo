import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { defaultEnglishWritingContract, koreanConversationWritingContract } from "@lervo/core";
import { createCachedRepositorySnapshotCapture } from "@lervo/orchestrator";
import { openProjectStorage } from "@lervo/project-storage";
import type { AdapterNormalizedEvent, AdapterSession, AdapterStartRequest } from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import {
  createAssignedManagedDeliberationExecutor,
  createManagedDeliberationExecutor,
} from "../src/managed-deliberation.js";
import { runCli } from "../src/main.js";
import { ManagedDeliberationError } from "../src/managed-deliberation-errors.js";
import { inspectManagedDeliberation } from "../src/deliberation-inspection.js";
import { parseSemanticEvaluation } from "../src/managed-deliberation-runner.js";
import type { RunProvider } from "../src/managed-run.js";
import { prepareRunVerification } from "../src/run-verification.js";
import {
  cleanupManagedDeliberationFixtures,
  clock,
  FixtureDeliberationAdapter,
  fixtureDeliberationEvidence,
  repository,
  semanticPass,
  sequence,
  writeFourRolePolicy,
} from "./managed-deliberation-test-fixture.js";

afterEach(cleanupManagedDeliberationFixtures);

describe("managed CLI deliberation convergence", () => {
  it("rejects an assigned origin whose immutable binding digest does not match", async () => {
    const executor = createAssignedManagedDeliberationExecutor();
    await expect(
      executor({
        deliberationId: "dlb_queue0001",
        expectedProjectId: "prj_cli_deliberation",
        origin: {
          sourceEventId: `cve_${"a".repeat(64)}`,
          conversationId: "cnv_cli_deliberation",
          threadId: null,
          requesterParticipantId: "ptc_cli_requester",
          originBindingDigest: `sha256:${"d".repeat(64)}`,
        },
        request: {
          repositoryRoot: "/not-opened",
          proposerProvider: "codex",
          reviewerProvider: "claude",
          verificationSuiteIds: ["project.default"],
          topic: "Reject an origin with a mismatched digest.",
        },
      }),
    ).rejects.toMatchObject({ code: "deliberation_request_invalid" });
  });

  it("accepts only an exact, complete semantic writing evaluation", () => {
    const request = {
      writingPolicyId: defaultEnglishWritingContract.writingPolicyId,
      locale: "ko-KR",
      surface: "chat" as const,
      audience: defaultEnglishWritingContract.audience,
      register: defaultEnglishWritingContract.prose.register,
      artifactId: "art_semantic_input_0001",
      contentHash: `sha256:${"1".repeat(64)}`,
      content: "This English sentence is ready for review.",
      checks: defaultEnglishWritingContract.verification.semanticChecks,
    };
    expect(parseSemanticEvaluation(semanticPass(), request, "claude").checks).toHaveLength(
      request.checks.length,
    );
    expect(() =>
      parseSemanticEvaluation(`\`\`\`json\n${semanticPass()}\n\`\`\``, request, "claude"),
    ).toThrow("not a JSON object");
    expect(() =>
      parseSemanticEvaluation(
        JSON.stringify({ checks: JSON.parse(semanticPass()).checks.slice(1) }),
        request,
        "claude",
      ),
    ).toThrow("does not include every required check");
  });

  it("records a terminal failure before provider start when canonical evidence is unavailable", async () => {
    const root = await repository();
    const nextId = sequence();
    let providerCalls = 0;
    const executor = createManagedDeliberationExecutor({
      openStorage: openProjectStorage,
      createId: nextId,
      now: clock(),
      prepareEvidence: async () => {
        throw new ManagedDeliberationError(
          "deliberation_evidence_unavailable",
          "No relevant evidence is available.",
        );
      },
      runner: {
        createAdapter: ({ provider }) => {
          providerCalls += 1;
          return new FixtureDeliberationAdapter(
            provider,
            `provider-session-${nextId("session")}`,
            "This provider must not start.",
            nextId("ctx"),
          );
        },
        createId: nextId,
        now: clock(),
        prepareVerification: prepareRunVerification,
      },
    });

    await expect(
      executor({
        repositoryRoot: root,
        proposerProvider: "codex",
        reviewerProvider: "claude",
        verificationSuiteIds: ["project.default"],
        topic: "Review a design without canonical evidence.",
      }),
    ).rejects.toMatchObject({ code: "deliberation_evidence_unavailable" });
    expect(providerCalls).toBe(0);
    const storage = await openProjectStorage(root);
    expect(
      storage.events.list({ limit: 1_000 }).find((event) => event.type === "deliberation.completed")
        ?.payload,
    ).toMatchObject({ status: "failed", failureCode: "deliberation_evidence_unavailable" });
    await storage.close();
  });

  it("returns a canonically recorded assigned-worker failure as a terminal summary", async () => {
    const root = await repository();
    await writeFourRolePolicy(root);
    const nextId = sequence();
    let providerCalls = 0;
    const executeAssignedManagedDeliberation = createAssignedManagedDeliberationExecutor({
      openStorage: openProjectStorage,
      createId: nextId,
      now: clock(),
      prepareEvidence: async () => {
        throw new ManagedDeliberationError(
          "deliberation_evidence_unavailable",
          "No relevant evidence is available.",
        );
      },
      runner: {
        createAdapter: ({ provider }) => {
          providerCalls += 1;
          return new FixtureDeliberationAdapter(
            provider,
            `provider-session-${nextId("session")}`,
            "This provider must not start.",
            nextId("ctx"),
          );
        },
        createId: nextId,
        now: clock(),
        prepareVerification: prepareRunVerification,
      },
    });
    let output = "";
    const exitCode = await runCli(
      [
        "deliberate",
        "assigned-worker",
        "--deliberation-id",
        "dlb_queue0001",
        "--project-id",
        "prj_cli_deliberation",
        "--root",
        root,
        "--stdin",
      ],
      {
        cwd: root,
        stdin: async () =>
          JSON.stringify({
            operation: "start",
            policyId: "deliberation_product-review",
            topic: "설계 근거를 검토해 주세요.",
            responseLanguage: "ko",
            executionMaximumElapsedMs: 240_000,
          }),
        stdout: (message) => {
          output += message;
        },
        stderr: () => undefined,
      },
      { executeAssignedManagedDeliberation },
    );

    expect(exitCode).toBe(2);
    expect(JSON.parse(output)).toEqual({
      schemaVersion: 1,
      deliberationId: "dlb_queue0001",
      status: "failed",
      artifactCount: 0,
    });
    expect(providerCalls).toBe(0);
  });

  it("stops before another provider turn when exact observed tokens reach the policy limit", async () => {
    const root = await repository();
    const nextId = sequence();
    let providerCalls = 0;
    const executor = createManagedDeliberationExecutor({
      openStorage: openProjectStorage,
      createId: nextId,
      now: clock(),
      prepareEvidence: async ({ topic }) => fixtureDeliberationEvidence(topic),
      runner: {
        createAdapter: ({ provider }) => {
          providerCalls += 1;
          return new FixtureDeliberationAdapter(
            provider,
            `provider-session-${nextId("session")}`,
            "The proposal is intentionally large enough to reach the observed token budget.",
            nextId("ctx"),
            200_000,
          );
        },
        createId: nextId,
        now: clock(),
        prepareVerification: prepareRunVerification,
      },
    });

    await expect(
      executor({
        repositoryRoot: root,
        proposerProvider: "codex",
        reviewerProvider: "claude",
        verificationSuiteIds: ["project.default"],
        topic: "Stop this deliberation at its exact observed token limit.",
      }),
    ).rejects.toMatchObject({ code: "deliberation_budget_exhausted" });
    expect(providerCalls).toBe(1);
  });

  it("aborts a hanging provider early enough to record a canonical failed outcome", async () => {
    const root = await repository();
    const nextId = sequence();
    let providerCalls = 0;
    const executor = createManagedDeliberationExecutor({
      openStorage: openProjectStorage,
      createId: nextId,
      now: () => new Date(),
      prepareEvidence: async ({ topic }) => fixtureDeliberationEvidence(topic),
      runner: {
        createAdapter: ({ provider }) => {
          providerCalls += 1;
          return new (class extends FixtureDeliberationAdapter {
            override async *events(
              _session: AdapterSession,
              signal: AbortSignal,
            ): AsyncIterable<AdapterNormalizedEvent> {
              if (!signal.aborted) {
                await new Promise<void>((resolveAbort) =>
                  signal.addEventListener("abort", () => resolveAbort(), { once: true }),
                );
              }
            }
          })(
            provider,
            `provider-session-${nextId("session")}`,
            "This result must never be accepted.",
            nextId("ctx"),
          );
        },
        createId: nextId,
        now: () => new Date(),
        prepareVerification: prepareRunVerification,
        finalizationReserveMs: 800,
      },
    });

    await expect(
      executor({
        repositoryRoot: root,
        proposerProvider: "codex",
        reviewerProvider: "claude",
        verificationSuiteIds: ["project.default"],
        topic: "Stop a provider that never completes its turn.",
        executionMaximumElapsedMs: 1_000,
      }),
    ).rejects.toMatchObject({ code: "deliberation_budget_exhausted" });
    expect(providerCalls).toBe(1);
    const storage = await openProjectStorage(root);
    const events = storage.events.list({ limit: 1_000 });
    expect(events.some((event) => event.type === "run.failed")).toBe(true);
    expect(events.find((event) => event.type === "deliberation.completed")?.payload).toMatchObject({
      status: "failed",
      failureCode: "deliberation_budget_exhausted",
    });
    await storage.close();
  });

  it("converges through independent Codex and Claude sessions with real verification", async () => {
    const root = await repository();
    const pass = semanticPass();
    const queues: Record<RunProvider, string[]> = {
      codex: [
        "Each role should read the same repository evidence in a separate session. Every record remains linked to verification results.",
        pass,
        pass,
        "The decision preserves independent sessions and separate context evidence. Repository verification passed, so this scope can be adopted.",
      ],
      claude: [
        pass,
        "Verdict: approved\n\nThe proposal separates each role session and its context evidence. No blocking issue remains in the reviewed scope.",
        "Repository verification runs the actual command separately. Its passing result supports only the current proposal.",
        pass,
      ],
    };
    const nextId = sequence();
    const now = clock();
    const adapterSettings: Array<{
      provider: RunProvider;
      executable?: string;
      model?: string;
      reasoningEffort?: string;
    }> = [];
    const structuredEvaluationSchemas: Record<string, unknown>[] = [];
    let snapshotCaptureFactoryCalls = 0;
    let snapshotCaptureCalls = 0;
    const executor = createManagedDeliberationExecutor({
      openStorage: openProjectStorage,
      createId: nextId,
      now,
      prepareEvidence: async ({ topic }) => fixtureDeliberationEvidence(topic),
      runner: {
        createAdapter: ({
          provider,
          executable,
          model,
          reasoningEffort,
          structuredOutputSchema,
        }) => {
          adapterSettings.push({
            provider,
            ...(executable === undefined ? {} : { executable }),
            ...(model === undefined ? {} : { model }),
            ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
          });
          if (structuredOutputSchema !== undefined) {
            structuredEvaluationSchemas.push(structuredOutputSchema);
          }
          const content = queues[provider].shift();
          if (content === undefined)
            throw new Error(`The ${provider} fixture response is missing.`);
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
        createSnapshotCapture: () => {
          snapshotCaptureFactoryCalls += 1;
          const capture = createCachedRepositorySnapshotCapture();
          return async (...args) => {
            snapshotCaptureCalls += 1;
            return capture(...args);
          };
        },
      },
    });
    const result = await executor({
      repositoryRoot: root,
      proposerProvider: "codex",
      reviewerProvider: "claude",
      verificationSuiteIds: ["project.default"],
      topic: "Decide how two providers review the same context independently.",
      providerExecutables: {
        codex: "/opt/providers/codex",
        claude: "/opt/providers/claude",
      },
      providerModels: { codex: "gpt-test", claude: "claude-test" },
      providerReasoningEfforts: { codex: "high", claude: "medium" },
    });

    expect(result.status).toBe("converged");
    expect(result.artifactCount).toBe(4);
    expect(queues).toEqual({ codex: [], claude: [] });
    expect(
      new Set(
        adapterSettings.map(
          ({ provider, executable, model, reasoningEffort }) =>
            `${provider}:${executable}:${model}:${reasoningEffort}`,
        ),
      ),
    ).toEqual(
      new Set([
        "codex:/opt/providers/codex:gpt-test:high",
        "claude:/opt/providers/claude:claude-test:medium",
      ]),
    );
    expect(structuredEvaluationSchemas).toHaveLength(4);
    expect(snapshotCaptureFactoryCalls).toBe(1);
    expect(snapshotCaptureCalls).toBe(16);
    expect(
      structuredEvaluationSchemas.every(
        (schema) =>
          (schema as { properties?: { checks?: { minItems?: number; maxItems?: number } } })
            .properties?.checks?.minItems ===
            defaultEnglishWritingContract.verification.semanticChecks.length &&
          (schema as { properties?: { checks?: { minItems?: number; maxItems?: number } } })
            .properties?.checks?.maxItems ===
            defaultEnglishWritingContract.verification.semanticChecks.length,
      ),
    ).toBe(true);
    const storage = await openProjectStorage(root);
    const events = storage.events.list({ limit: 1000 });
    const artifactEvents = events.filter(
      (event) => event.type === "deliberation.artifact.recorded",
    );
    expect(artifactEvents).toHaveLength(4);
    const participantNames = new Map(
      result.participants.map((participant) => [participant.roleId, participant.name]),
    );
    expect(
      artifactEvents.every(
        (event) =>
          typeof event.payload.producerRoleId === "string" &&
          event.payload.producerRoleName === participantNames.get(event.payload.producerRoleId),
      ),
    ).toBe(true);
    expect(events.filter((event) => event.type === "context.published")).toHaveLength(4);
    expect(events.filter((event) => event.type === "handoff.created")).toHaveLength(8);
    expect(events.filter((event) => event.type === "verification.completed")).toHaveLength(1);
    const injectedEvidence = events
      .filter((event) => event.type === "context.injected")
      .map((event) => event.payload.documentIds as string[]);
    expect(injectedEvidence).toHaveLength(8);
    expect(
      injectedEvidence.filter(
        (documentIds) =>
          documentIds.some((documentId) => documentId.endsWith("_manifest")) &&
          documentIds.some((documentId) => /_01$/u.test(documentId)),
      ),
    ).toHaveLength(4);
    expect(
      events.filter((event) => event.type === "deliberation.completed")[0]?.payload,
    ).toMatchObject({ status: "converged" });
    const sessions = events
      .filter((event) => event.type === "adapter.started")
      .map((event) => event.payload.providerSessionId);
    expect(new Set(sessions).size).toBe(8);
    const causal = events.filter((event) => event.type === "work.causality.recorded");
    const roots = causal.filter((event) => event.payload.relationship === "root");
    expect(roots).toHaveLength(1);
    expect(causal).toHaveLength(sessions.length + 1);
    expect(new Set(causal.map((event) => event.payload.workId))).toEqual(
      new Set([roots[0]!.payload.workId]),
    );
    expect(
      causal
        .filter((event) => event.payload.relationship !== "root")
        .every((event) => event.payload.parentRunId === roots[0]!.runId),
    ).toBe(true);
    expect(causal.map((event) => event.payload.relationship)).toContain("deliberation");
    expect(causal.map((event) => event.payload.relationship)).toContain("publication_evaluation");
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

  it("retries only a failed semantic evaluator child run after provider startup failure", async () => {
    const root = await repository();
    const pass = semanticPass();
    const queues: Record<RunProvider, string[]> = {
      codex: [
        "Each role uses independent evidence, and repository verification remains required.",
        pass,
        pass,
        "The decision adopts independent evidence and required repository verification.",
      ],
      claude: [
        pass,
        "Verdict: approved\n\nThe proposal preserves independent review and verification evidence.",
        "Repository verification passed independently for the proposed decision.",
        pass,
      ],
    };
    const nextId = sequence();
    let failedEvaluatorStart = false;
    const executor = createManagedDeliberationExecutor({
      openStorage: openProjectStorage,
      createId: nextId,
      now: clock(),
      prepareEvidence: async ({ topic }) => fixtureDeliberationEvidence(topic),
      runner: {
        createAdapter: ({ provider, structuredOutputSchema }) => {
          if (
            provider === "claude" &&
            structuredOutputSchema !== undefined &&
            !failedEvaluatorStart
          ) {
            failedEvaluatorStart = true;
            return new (class extends FixtureDeliberationAdapter {
              override async start(_request: AdapterStartRequest): Promise<never> {
                throw new Error("transient evaluator startup failure");
              }
            })(provider, `provider-session-${nextId("session")}`, pass, nextId("ctx"));
          }
          const content = queues[provider].shift();
          if (content === undefined) throw new Error(`${provider} fixture response is missing.`);
          return new FixtureDeliberationAdapter(
            provider,
            `provider-session-${nextId("session")}`,
            content,
            nextId("ctx"),
          );
        },
        createId: nextId,
        now: clock(),
        prepareVerification: prepareRunVerification,
      },
    });

    const result = await executor({
      repositoryRoot: root,
      proposerProvider: "codex",
      reviewerProvider: "claude",
      verificationSuiteIds: ["project.default"],
      topic: "Decide how evaluator startup failures recover safely.",
    });

    expect(result.status).toBe("converged");
    expect(queues).toEqual({ codex: [], claude: [] });
    const storage = await openProjectStorage(root);
    const events = storage.events.list({ limit: 1000 });
    expect(
      events.some(
        (event) =>
          event.type === "run.failed" && event.payload.failureCode === "provider_start_failed",
      ),
    ).toBe(true);
    expect(
      events
        .filter(
          (event) =>
            event.type === "work.causality.recorded" &&
            event.payload.relationship === "publication_evaluation",
        )
        .map((event) => event.payload.attemptOrdinal),
    ).toEqual([1, 2, 1, 1, 1]);
    expect(storage.events.verifyIntegrity().valid).toBe(true);
    await storage.close();
  });

  it("uses the Korean chat writing contract for a Korean conversation deliberation", async () => {
    const root = await repository();
    const pass = semanticPass(koreanConversationWritingContract);
    const queues: Record<RunProvider, string[]> = {
      codex: [
        "검토 결과, 독립된 역할별 검토와 저장소 검증을 유지하는 설계를 채택해야 합니다.",
        pass,
        pass,
        "독립된 역할별 검토와 저장소 검증을 유지하는 설계를 최종 채택합니다. Lervo 실행기가 다음 구현 범위를 담당합니다.",
      ],
      claude: [
        pass,
        "판정: 승인\n\n제안은 역할별 독립성과 검증 근거를 분리하며 차단 이슈가 없습니다.",
        "별도로 실행한 project.default 검증이 통과했으며 현재 제안의 저장소 계약을 확인합니다.",
        pass,
      ],
    };
    const nextId = sequence();
    const executor = createManagedDeliberationExecutor({
      openStorage: openProjectStorage,
      createId: nextId,
      now: clock(),
      prepareEvidence: async ({ topic }) => fixtureDeliberationEvidence(topic),
      runner: {
        createAdapter: ({ provider }) => {
          const content = queues[provider].shift();
          if (content === undefined) throw new Error(`${provider} fixture response is missing.`);
          return new FixtureDeliberationAdapter(
            provider,
            `provider-session-${nextId("session")}`,
            content,
            nextId("ctx"),
          );
        },
        createId: nextId,
        now: clock(),
        prepareVerification: prepareRunVerification,
      },
    });

    const result = await executor({
      repositoryRoot: root,
      proposerProvider: "codex",
      reviewerProvider: "claude",
      verificationSuiteIds: ["project.default"],
      topic: "이해관계자별로 설계를 검토하고 최종 결론을 내린다.",
      responseLanguage: "ko",
    });

    expect(result.status).toBe("converged");
    expect(result.finalContent).toContain("최종 채택합니다");
    const [deliberationRoot] = await readdir(resolve(root, ".lervo/state/deliberations"));
    const writingPolicy = JSON.parse(
      await readFile(
        resolve(
          root,
          ".lervo/state/deliberations",
          deliberationRoot!,
          "writing-policy/content.json",
        ),
        "utf8",
      ),
    );
    expect(writingPolicy).toMatchObject({
      writingPolicyId: "writing_ko-conversation",
      locale: "ko",
    });
  });

  it("repairs a Korean direct-result failure and still reaches a verified decision", async () => {
    const root = await repository();
    const pass = semanticPass(koreanConversationWritingContract);
    const failedDirectResult = JSON.stringify({
      checks: koreanConversationWritingContract.verification.semanticChecks.map((check) => ({
        checkId: check.checkId,
        status: check.checkId === "direct_result_and_action" ? "failed" : "passed",
        violationCount: check.checkId === "direct_result_and_action" ? 1 : 0,
      })),
    });
    const queues: Record<RunProvider, string[]> = {
      codex: [
        "설계 근거를 정리했습니다. 제품 책임자가 다음 작업을 진행해야 합니다.",
        "결론은 역할별 독립 검토와 저장소 검증을 유지하는 것입니다. 사용자는 같은 대화에서 검토 결과를 확인할 수 있으며, 이 제안 범위에서 추가 행동은 없습니다.",
        pass,
        pass,
        "역할별 독립 검토와 저장소 검증을 유지하는 설계를 최종 채택합니다. 사용자는 원래 대화에서 검증된 결론을 확인할 수 있으며, 이 결정 범위에서 추가 행동은 없습니다.",
      ],
      claude: [
        failedDirectResult,
        pass,
        "판정: 승인\n\n제안은 사용자가 체감할 결과와 검증 범위를 직접 밝혔으며 남은 차단 조건이 없습니다.",
        "별도로 실행한 project.default 검증이 통과했으며 현재 결정 범위의 저장소 계약을 확인합니다.",
        pass,
      ],
    };
    const nextId = sequence();
    const executor = createManagedDeliberationExecutor({
      openStorage: openProjectStorage,
      createId: nextId,
      now: clock(),
      prepareEvidence: async ({ topic }) => fixtureDeliberationEvidence(topic),
      runner: {
        createAdapter: ({ provider }) => {
          const content = queues[provider].shift();
          if (content === undefined) throw new Error(`${provider} fixture response is missing.`);
          return new FixtureDeliberationAdapter(
            provider,
            `provider-session-${nextId("session")}`,
            content,
            nextId("ctx"),
          );
        },
        createId: nextId,
        now: clock(),
        prepareVerification: prepareRunVerification,
      },
    });

    const result = await executor({
      repositoryRoot: root,
      proposerProvider: "codex",
      reviewerProvider: "claude",
      verificationSuiteIds: ["project.default"],
      topic: "사용자에게 직접 보이는 한국어 설계를 검토하고 결론을 내린다.",
      responseLanguage: "ko",
    });

    expect(result.status).toBe("converged");
    expect(result.finalContent).toContain("최종 채택합니다");
    expect(queues).toEqual({ codex: [], claude: [] });
    const storage = await openProjectStorage(root);
    const events = storage.events.list({ limit: 1_000 });
    expect(events.filter((event) => event.type === "adapter.started")).toHaveLength(10);
    expect(events.filter((event) => event.type === "deliberation.artifact.recorded")).toHaveLength(
      4,
    );
    expect(events.find((event) => event.type === "deliberation.completed")?.payload).toMatchObject({
      status: "converged",
    });
    expect(storage.events.verifyIntegrity().valid).toBe(true);
    await storage.close();
  });

  it("keeps a terminal publication failure consistent and exposes quarantined artifacts", async () => {
    const root = await repository();
    const failedEvaluation = JSON.stringify({
      checks: defaultEnglishWritingContract.verification.semanticChecks.map((check, index) => ({
        checkId: check.checkId,
        status: index === 0 ? "failed" : "passed",
        violationCount: index === 0 ? 1 : 0,
      })),
    });
    const queues: Record<RunProvider, string[]> = {
      codex: [
        "The proposal is recoverable even when both publication attempts are blocked.",
        "The proposal is recoverable even when both publication attempts are blocked.",
      ],
      claude: [failedEvaluation, failedEvaluation],
    };
    const nextId = sequence();
    const now = clock();
    const executor = createManagedDeliberationExecutor({
      openStorage: openProjectStorage,
      createId: nextId,
      now,
      prepareEvidence: async ({ topic }) => fixtureDeliberationEvidence(topic),
      runner: {
        createAdapter: ({ provider }) => {
          const content = queues[provider].shift();
          if (content === undefined)
            throw new Error(`The ${provider} fixture response is missing.`);
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

    await expect(
      executor({
        repositoryRoot: root,
        proposerProvider: "codex",
        reviewerProvider: "claude",
        verificationSuiteIds: ["project.default"],
        topic: "Preserve evidence from a failed publication.",
      }),
    ).rejects.toMatchObject({ code: "artifact_publication_failed" });

    const storage = await openProjectStorage(root);
    const completed = storage.events
      .list({ limit: 1_000 })
      .find((event) => event.type === "deliberation.completed");
    const report = await inspectManagedDeliberation({
      storage,
      deliberationId: String(completed?.payload.deliberationId),
    });
    expect(report).toMatchObject({
      sourceStatus: "consistent",
      phase: "completed",
      completionStatus: "failed",
      artifactCount: 0,
      publishedArtifactCount: 0,
      quarantinedArtifactCount: 1,
      issues: [],
    });
    expect(report.failedPublications).toHaveLength(2);
    expect(
      report.failedPublications.every((item) => item.recoveryCommand.includes(item.contentHash)),
    ).toBe(true);
    await storage.close();
  });
});
