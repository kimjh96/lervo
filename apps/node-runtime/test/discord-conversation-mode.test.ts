import { createHash } from "node:crypto";

import {
  createConversationInboundEvent,
  createConversationParticipationPolicy,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import type { ConversationResponder } from "@lervo/interaction";
import type { ArtifactStore } from "@lervo/storage-contract";
import { describe, expect, it, vi } from "vitest";

import type {
  ConversationIntent,
  ConversationIntentResolver,
} from "../src/conversation-intent-resolver.js";
import { NaturalLanguageDiscordConversationResponder } from "../src/discord-conversation-mode.js";

const applicationId = "999999999999999999";

describe("natural-language Discord conversation mode", () => {
  it("accepts ordinary and mentioned messages while routing by semantic intent", async () => {
    const participationPolicy = createConversationParticipationPolicy({
      projectId: "prj_test0001",
      roleId: "developer",
      conversationIds: ["cnv_test0001"],
      mode: "relevant",
      respondTo: ["human"],
      signalCodes: [],
      cooldownSeconds: 0,
      maxResponsesPerHour: 8,
      maxAutomationDepth: 2,
      createdAt: "2026-09-07T07:00:00.000Z",
    });
    let message = "What remains in the current workstream?";
    let intent: ConversationIntent = "answer";
    let effect = { kind: "none" as const } as
      | { kind: "none" }
      | { kind: "repository_work" }
      | { kind: "discord_current_member_nickname_set"; nickname: string };
    const readOnly = {
      respond: vi.fn<ConversationResponder["respond"]>(async () => candidate("Read-only answer.")),
    };
    const continuation = {
      respond: vi.fn<ConversationResponder["respond"]>(async () => candidate("Work was queued.")),
    };
    const platformAction = {
      availableEffects: [
        "none" as const,
        "repository_work" as const,
        "discord_current_member_nickname_set" as const,
      ],
      respond: vi.fn(async () => candidate("Display name changed.")),
    };
    const stored = new Map<string, Uint8Array>();
    const put: ArtifactStore["put"] = async (content) => {
      const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
      const contentHash = hash(bytes);
      const uri = `lervo-cas://sha256/${contentHash.slice(7)}`;
      stored.set(uri, bytes);
      return { uri, contentHash, byteCount: bytes.byteLength, created: true };
    };
    const artifactStore: ArtifactStore = {
      put,
      putStream: async (chunks) => {
        const collected: Uint8Array[] = [];
        for await (const chunk of chunks) {
          collected.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
        }
        return put(Buffer.concat(collected));
      },
      get: async (uri) => stored.get(uri)!,
      has: async (uri) => stored.has(uri),
    };
    const candidate = async (content: string) => {
      const bytes = new TextEncoder().encode(content);
      await artifactStore.put(bytes);
      return {
        content: { contentHash: hash(bytes), byteCount: bytes.byteLength },
      } as Awaited<ReturnType<ConversationResponder["respond"]>>;
    };
    const resolveIntent = vi.fn<ConversationIntentResolver["resolve"]>(async () => ({
      intent,
      confidence: "high" as const,
      participation: "relevant" as const,
      effect,
      provider: { providerId: "codex", model: null, adapterVersion: "2" as const },
      resultDigest: `sha256:${"e".repeat(64)}`,
    }));
    const resolver: ConversationIntentResolver = { resolve: resolveIntent };
    const resolutions = new Map<
      string,
      Awaited<ReturnType<ConversationIntentResolver["resolve"]>>
    >();
    const resolutionStore = {
      read: async (event: { eventId: string }) => resolutions.get(event.eventId) ?? null,
      record: async (input: {
        event: { eventId: string };
        resolution: Awaited<ReturnType<ConversationIntentResolver["resolve"]>>;
      }) => {
        resolutions.set(input.event.eventId, input.resolution);
      },
    };
    const responder = new NaturalLanguageDiscordConversationResponder({
      applicationId,
      respondingAgent: { agentId: `agt_${"a".repeat(24)}`, roleId: "developer" },
      repositoryRoot: process.cwd(),
      artifactStore,
      history: {
        recent: async () => [
          {
            role: "user",
            text: "Please inspect the active work.",
            speaker: {
              kind: "human",
              participantId: "ptc_test0001",
              agentId: null,
              roleId: null,
            },
          },
          {
            role: "assistant",
            text: "The active work is ready to continue.",
            speaker: {
              kind: "agent",
              participantId: "ptc_lervoagent",
              agentId: `agt_${"a".repeat(24)}`,
              roleId: "developer",
            },
          },
        ],
      },
      resolutionStore,
      intentResolver: resolver,
      participationPolicy,
      readOnly: readOnly as ConversationResponder,
      continuation: continuation as ConversationResponder,
      platformAction,
    });
    const input = async (eventId: string) => {
      const bytes = new TextEncoder().encode(message);
      const storedMessage = await artifactStore.put(bytes);
      return {
        event: createConversationInboundEvent({
          sourceEventKeyHash: hashConversationSourceEventKey(eventId),
          target: {
            integrationId: "itg_test0001",
            projectId: "prj_test0001",
            conversationId: "cnv_test0001",
            threadId: null,
          },
          kind: "message.created",
          actor: { kind: "human", participantId: "ptc_test0001", roleId: null },
          mentions: { participantIds: [], roleIds: [] },
          content: {
            artifactId: `art_${eventId}`,
            contentHash: storedMessage.contentHash,
            byteCount: storedMessage.byteCount,
            mediaType: "text/plain; charset=utf-8",
          },
          replyToEventId: null,
          signalCode: null,
          automationDepth: 0,
          occurredAt: "2026-09-07T08:00:00.000Z",
        }),
      } as Parameters<ConversationResponder["respond"]>[0];
    };

    const first = await input("cevt_test0001");
    await responder.respond(first);
    expect(readOnly.respond).toHaveBeenCalledOnce();
    expect(resolveIntent.mock.calls[0]![0]).toMatchObject({ mentioned: false, message });
    await expect(responder.evaluate(first)).resolves.toBe("relevant");
    expect(resolveIntent).toHaveBeenCalledTimes(1);

    intent = "continue_work";
    effect = { kind: "repository_work" };
    message = `<@${applicationId}> Finish it.`;
    const second = await input("cevt_test0002");
    second.event.mentions.participantIds.push("ptc_lervoagent");
    await responder.respond(second);
    expect(continuation.respond).toHaveBeenCalledOnce();
    expect(resolveIntent.mock.calls[1]![0]).toMatchObject({
      mentioned: true,
      message: "Finish it.",
    });
    expect(resolveIntent.mock.calls[1]![0].priorTurns).toHaveLength(2);
    expect(continuation.respond.mock.calls[0]![0].context?.priorTurns).toHaveLength(2);

    effect = { kind: "discord_current_member_nickname_set", nickname: "Lervo" };
    message = "Change your server nickname to Lervo.";
    const third = await input("cevt_test0003");
    await responder.respond(third);
    expect(platformAction.respond).toHaveBeenCalledWith(
      expect.objectContaining({ context: { priorTurns: expect.any(Array) } }),
      { kind: "discord_current_member_nickname_set", nickname: "Lervo" },
    );

    const restarted = new NaturalLanguageDiscordConversationResponder({
      applicationId,
      respondingAgent: { agentId: `agt_${"a".repeat(24)}`, roleId: "developer" },
      repositoryRoot: process.cwd(),
      artifactStore,
      history: { recent: async () => [] },
      resolutionStore,
      intentResolver: resolver,
      participationPolicy,
      readOnly: readOnly as ConversationResponder,
      continuation: continuation as ConversationResponder,
      platformAction: {
        availableEffects: ["none", "repository_work"],
        respond: vi.fn(),
      },
    });
    await restarted.respond(first);
    expect(resolveIntent).toHaveBeenCalledTimes(3);
    expect(readOnly.respond).toHaveBeenCalledTimes(2);

    const managedReply = await candidate("One managed turn resolved and answered this message.");
    const managedResolve = vi.fn(async () => ({
      intent: "answer" as const,
      confidence: "high" as const,
      participation: "relevant" as const,
      effect: { kind: "none" as const, argument: null },
      provider: { providerId: "codex", model: "gpt-managed", adapterVersion: "3" as const },
      resultDigest: `sha256:${"f".repeat(64)}`,
      replyCandidate: managedReply,
    }));
    const managedMode = new NaturalLanguageDiscordConversationResponder({
      applicationId,
      respondingAgent: { agentId: `agt_${"a".repeat(24)}`, roleId: "developer" },
      repositoryRoot: process.cwd(),
      artifactStore,
      history: { recent: async () => [] },
      resolutionStore: {
        read: async () => null,
        record: async () => undefined,
      },
      managedTurnResolver: { resolve: managedResolve },
      surfaceEffects: [],
      participationPolicy,
      readOnly: {
        respond: vi.fn(async () => candidate("Legacy read path must not run.")),
      },
      continuation: continuation as ConversationResponder,
      platformAction,
    });
    message = "Which model is answering me?";
    const fourth = await input("cevt_test0004");
    await expect(managedMode.evaluate(fourth)).resolves.toBe("relevant");
    await expect(managedMode.respond(fourth)).resolves.toEqual(managedReply);
    expect(managedResolve).toHaveBeenCalledTimes(1);
  });
});

function hash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
