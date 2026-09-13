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
  it.each(["changed", "read_only", "running"])(
    "keeps contextual results and independent evidence without replaying work (%s)",
    async (scenario) => {
      const changed = scenario === "changed";
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
      const store = SQLiteConversationRepositoryWorkStore.open(resolve(root, "work.sqlite"));
      const responder = new ConversationRepositoryWorkResponder({
        repositoryRoot: root,
        artifactStore: artifacts,
        store,
        parentAgentId: "agt_111111111111111111111111",
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
        timeoutMs: 5_000,
        completionLifecycle: {
          capture: async () => ({
            workstreamId: null,
            workstreamRevision: null,
            repositoryRevision: `sha256:${"a".repeat(64)}`,
            knowledgeCurrent: true,
          }),
          verify: verifyCompletion,
        },
      });
      if (scenario === "running") {
        store.begin({
          eventId: event.eventId,
          conversationId: event.target.conversationId,
          threadId: event.target.threadId,
          workerId: "agt_111111111111111111111111",
          provider: "codex",
          requestContentHash: source.contentHash,
          startedAt: new Date().toISOString(),
        });
        try {
          const reply = await responder.respond({ event } as never);
          expect(executeTurn).not.toHaveBeenCalled();
          expect(verifyCompletion).not.toHaveBeenCalled();
          const content = await artifacts.get(
            `lervo-cas://sha256/${reply.content.contentHash.slice(7)}`,
          );
          expect(new TextDecoder().decode(content)).toContain("중복 실행을 차단했습니다");
        } finally {
          responder.close();
        }
        return;
      }
      const first = await responder.respond({ event } as never);
      const second = await responder.respond({ event } as never);
      expect(executeTurn).toHaveBeenCalledTimes(1);
      expect(executeTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-6-astra",
          reasoningEffort: "medium",
          externalEffectsAuthorized: true,
        }),
      );
      expect(verifyCompletion).toHaveBeenCalledWith(
        expect.objectContaining({
          requestedModel: "gpt-6-astra",
          requestedReasoningEffort: "medium",
          changedPaths: changed
            ? expect.arrayContaining(["README.md"])
            : expect.not.arrayContaining(["README.md"]),
        }),
      );
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
