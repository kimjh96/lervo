import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { FileSystemCas } from "@lervo/cas";
import {
  createConversationInboundEvent,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationRepositoryWorkResponder } from "../src/conversation-repository-work-responder.js";
import { SQLiteConversationRepositoryWorkStore } from "../src/conversation-repository-work-store.js";

const execute = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("ConversationRepositoryWorkResponder", () => {
  it.each([
    "changed",
    "changed_async",
    "read_only",
    "running",
    "recovered",
    "configured_owner",
    "legacy_delegate",
    "historical_delegate",
  ])(
    "keeps contextual results and independent evidence without replaying work (%s)",
    async (scenario) => {
      const changed = scenario === "changed" || scenario === "changed_async";
      const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-work-"));
      roots.push(root);
      await execute("git", ["init", "-b", "main"], { cwd: root });
      await execute("git", ["config", "user.email", "lervo-test@example.invalid"], { cwd: root });
      await execute("git", ["config", "user.name", "Lervo Test"], { cwd: root });
      await writeFile(resolve(root, "README.md"), "before\n");
      await execute("git", ["add", "README.md"], { cwd: root });
      await execute("git", ["commit", "-m", "fixture"], { cwd: root });
      const artifacts = await FileSystemCas.open(resolve(root, ".artifacts"));
      const source = await artifacts.put(
        changed ? "README를 실제로 수정해." : "README의 내용을 확인해.",
      );
      const event = createConversationInboundEvent({
        sourceEventKeyHash: hashConversationSourceEventKey("discord-work-1"),
        target: {
          integrationId: "itg_discord01",
          projectId: "prj_test0001",
          conversationId: "cnv_test0001",
          threadId: null,
        },
        kind: "message.created",
        actor: { kind: "human", participantId: "ptc_owner0001", roleId: null },
        content: {
          artifactId: `art_${source.contentHash.slice(7)}`,
          contentHash: source.contentHash,
          byteCount: source.byteCount,
          mediaType: "text/plain; charset=utf-8",
        },
        mentions: { participantIds: [], roleIds: [] },
        replyToEventId: null,
        signalCode: null,
        automationDepth: 0,
        occurredAt: "2026-09-10T00:00:00.000Z",
      });
      const executeTurn = vi.fn(async () => {
        if (changed) await writeFile(resolve(root, "README.md"), "after\n");
        return {
          provider: "codex" as const,
          providerSessionId: "11111111-1111-4111-8111-111111111111",
          response: changed
            ? "README.md를 수정하고 확인했습니다."
            : "README.md에는 before라고 적혀 있습니다.",
          completedAt: "2026-09-10T00:01:00.000Z",
        };
      });
      const verifyCompletion = vi.fn(async () => undefined);
      const recoveredResult = await artifacts.put("중단 전에 완료된 검증 결과입니다.");
      let store = SQLiteConversationRepositoryWorkStore.open(resolve(root, "work.sqlite"));
      if (scenario === "configured_owner" || scenario === "legacy_delegate") {
        const delegate = {
          agentId: "agt_222222222222222222222222",
          displayName: "Navi",
          roleId: "developer",
          provider: "codex" as const,
        };
        store.activateDelegate({
          conversationId: event.target.conversationId,
          threadId: null,
          delegate,
          activatedAt: event.occurredAt,
        });
        const previous = await artifacts.put("Navi's private earlier result");
        const coordinates = {
          eventId: "evt_previous_delegate",
          conversationId: event.target.conversationId,
          threadId: null,
          workerId: delegate.agentId,
          provider: delegate.provider,
        };
        store.begin({
          ...coordinates,
          requestContentHash: previous.contentHash,
          startedAt: event.occurredAt,
        });
        store.complete({
          ...coordinates,
          providerSessionId: "22222222-2222-4222-8222-222222222222",
          result: previous,
          completedAt: event.occurredAt,
        });
        store.close();
        store = SQLiteConversationRepositoryWorkStore.open(resolve(root, "work.sqlite"));
      }
      const responder = new ConversationRepositoryWorkResponder({
        repositoryRoot: root,
        artifactStore: artifacts,
        store,
        parentAgentId: "agt_111111111111111111111111",
        ...(scenario === "legacy_delegate"
          ? { workerSelection: "conversation_delegate" as const }
          : {}),
        executors: { codex: { provider: "codex", execute: executeTurn } },
        models: { codex: "gpt-6-astra" },
        reasoningEfforts: { codex: "medium" },
        authorizedEffectRequesters: [
          {
            participantId: "ptc_owner0001",
            roleId: "owner",
            conversationId: "cnv_test0001",
          },
        ],
        defaultProvider: "codex",
        ...(scenario === "changed_async" ? { knowledgeMode: "pending_background" as const } : {}),
        timeoutMs: 5_000,
        completionLifecycle: {
          capture: async () => ({
            workstreamId: null,
            workstreamRevision: null,
            knowledgeCurrent: true,
          }),
          recover: async () =>
            scenario === "recovered"
              ? {
                  completedAt: "2026-09-10T00:01:00.000Z",
                  result: recoveredResult,
                }
              : null,
          verify: verifyCompletion,
        },
      });
      if (
        scenario === "running" ||
        scenario === "recovered" ||
        scenario === "historical_delegate"
      ) {
        store.begin({
          eventId: event.eventId,
          conversationId: event.target.conversationId,
          threadId: event.target.threadId,
          workerId:
            scenario === "historical_delegate"
              ? "agt_222222222222222222222222"
              : "agt_111111111111111111111111",
          provider: "codex",
          requestContentHash: source.contentHash,
          startedAt: new Date().toISOString(),
        });
        try {
          if (scenario === "historical_delegate") {
            await expect(responder.respond({ event } as never)).rejects.toThrow();
            expect(executeTurn).not.toHaveBeenCalled();
            expect(verifyCompletion).not.toHaveBeenCalled();
            return;
          }
          if (scenario === "running") {
            await expect(responder.respond({ event } as never)).rejects.toMatchObject({
              code: "repository_work_in_progress",
            });
            expect(executeTurn).not.toHaveBeenCalled();
            expect(verifyCompletion).not.toHaveBeenCalled();
            return;
          }
          const reply = await responder.respond({ event } as never);
          expect(executeTurn).not.toHaveBeenCalled();
          expect(verifyCompletion).not.toHaveBeenCalled();
          const content = await artifacts.get(
            `lervo-cas://sha256/${reply.content.contentHash.slice(7)}`,
          );
          expect(new TextDecoder().decode(content)).toBe("중단 전에 완료된 검증 결과입니다.");
          expect(
            store.begin({
              eventId: event.eventId,
              conversationId: event.target.conversationId,
              threadId: event.target.threadId,
              workerId: "agt_111111111111111111111111",
              provider: "codex",
              requestContentHash: source.contentHash,
              startedAt: new Date().toISOString(),
            }).completed,
          ).toEqual({
            contentHash: recoveredResult.contentHash,
            byteCount: recoveredResult.byteCount,
          });
        } finally {
          responder.close();
        }
        return;
      }
      const first = await responder.respond({ event } as never);
      const second = await responder.respond({ event } as never);
      expect(executeTurn).toHaveBeenCalledTimes(1);
      if (scenario === "configured_owner" || scenario === "legacy_delegate") {
        const delegated = scenario === "legacy_delegate";
        expect(executeTurn).toHaveBeenCalledWith(
          expect.objectContaining({
            providerSessionId: delegated ? "22222222-2222-4222-8222-222222222222" : null,
            instructions: delegated
              ? expect.stringContaining("Navi's private earlier result")
              : expect.not.stringContaining("Navi"),
          }),
        );
        expect(store.activeDelegate(event.target.conversationId, null)?.displayName).toBe("Navi");
        expect(
          store.recentCompletedResults({
            conversationId: event.target.conversationId,
            threadId: null,
            workerId: delegated ? "agt_222222222222222222222222" : "agt_111111111111111111111111",
          }),
        ).toHaveLength(delegated ? 2 : 1);
      }
      expect(executeTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-6-astra",
          reasoningEffort: "medium",
          externalEffectsAuthorized: true,
          instructions: expect.stringMatching(
            /At \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z, stop new implementation/u,
          ),
        }),
      );
      expect(verifyCompletion).toHaveBeenCalledWith(
        expect.objectContaining({
          requestedModel: "gpt-6-astra",
          requestedReasoningEffort: "medium",
          repositoryChange: expect.objectContaining({
            changedPaths: changed
              ? expect.arrayContaining(["README.md"])
              : expect.not.arrayContaining(["README.md"]),
          }),
          executionProfile: null,
          checkpointDisposition: "not_observed",
          allocationReason:
            scenario === "legacy_delegate" ? "bound_agent_provider" : "configured_default",
        }),
      );
      if (scenario === "changed_async") {
        expect(verifyCompletion).toHaveBeenCalledWith(
          expect.objectContaining({
            knowledgeMode: "pending_background",
            sourceManifest: expect.objectContaining({
              manifest: expect.objectContaining({
                paths: expect.arrayContaining([expect.objectContaining({ path: "README.md" })]),
              }),
              contentHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
            }),
          }),
        );
      }
      expect(first.content.contentHash).toBe(second.content.contentHash);
      const result = await artifacts.get(
        `lervo-cas://sha256/${first.content.contentHash.slice("sha256:".length)}`,
      );
      expect(new TextDecoder().decode(result)).toContain("README.md");
      expect(new TextDecoder().decode(result)).not.toContain("—");
      expect(new TextDecoder().decode(result)).not.toContain("저장소 변경 관측");
      responder.close();
    },
  );
});
