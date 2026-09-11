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
  it("executes real repository work once and reuses its durable result", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-work-"));
    roots.push(root);
    await execute("git", ["init", "-b", "main"], { cwd: root });
    await execute("git", ["config", "user.email", "lervo-test@example.invalid"], { cwd: root });
    await execute("git", ["config", "user.name", "Lervo Test"], { cwd: root });
    await writeFile(resolve(root, "README.md"), "before\n");
    await execute("git", ["add", "README.md"], { cwd: root });
    await execute("git", ["commit", "-m", "fixture"], { cwd: root });
    const artifacts = await FileSystemCas.open(resolve(root, ".artifacts"));
    const source = await artifacts.put("README를 실제로 수정해.");
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
      await writeFile(resolve(root, "README.md"), "after\n");
      return {
        provider: "codex" as const,
        providerSessionId: "11111111-1111-4111-8111-111111111111",
        response: "README를 수정했습니다. — 확인했습니다.",
        completedAt: "2026-09-10T00:01:00.000Z",
      };
    });
    const verifyCompletion = vi.fn(async () => undefined);
    const responder = new ConversationRepositoryWorkResponder({
      repositoryRoot: root,
      artifactStore: artifacts,
      store: SQLiteConversationRepositoryWorkStore.open(resolve(root, "work.sqlite")),
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
      }),
    );
    expect(first.content.contentHash).toBe(second.content.contentHash);
    const result = await artifacts.get(
      `lervo-cas://sha256/${first.content.contentHash.slice("sha256:".length)}`,
    );
    expect(new TextDecoder().decode(result)).toContain("README.md");
    expect(new TextDecoder().decode(result)).not.toContain("—");
    responder.close();
  });
});
