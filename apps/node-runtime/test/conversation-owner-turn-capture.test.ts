import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  createConversationInboundEvent,
  createConversationParticipationPolicy,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import type { ConversationResponder } from "@lervo/interaction";
import { listQueuedInstructionCaptures } from "@lervo/repository-knowledge-runtime";
import type { ArtifactStore } from "@lervo/storage-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createConversationOwnerTurnCapture } from "../src/conversation-owner-turn-capture.js";
import type { ConversationIntentResolver } from "../src/conversation-intent-resolver.js";
import { NaturalLanguageDiscordConversationResponder } from "../src/discord-conversation-mode.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const hash = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function memoryArtifacts(): ArtifactStore {
  const stored = new Map<string, Uint8Array>();
  const put: ArtifactStore["put"] = async (content) => {
    const bytes = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const contentHash = hash(bytes);
    const uri = `lervo-cas://sha256/${contentHash.slice(7)}`;
    stored.set(uri, bytes);
    return { uri, contentHash, byteCount: bytes.byteLength, created: true };
  };
  return {
    put,
    putStream: async () => {
      throw new Error("unused");
    },
    get: async (uri) => stored.get(uri)!,
    has: async (uri) => stored.has(uri),
  };
}

async function inbound(
  artifacts: ArtifactStore,
  message: string,
  actor: { kind: "human" | "agent"; participantId: string; roleId: string | null },
  key: string,
) {
  const stored = await artifacts.put(new TextEncoder().encode(message));
  return createConversationInboundEvent({
    sourceEventKeyHash: hashConversationSourceEventKey(key),
    target: {
      integrationId: "itg_test0001",
      projectId: "prj_test0001",
      conversationId: "cnv_test0001",
      threadId: null,
    },
    kind: "message.created",
    actor: actor as never,
    mentions: { participantIds: [], roleIds: [] },
    content: {
      artifactId: `art_${key}`,
      contentHash: stored.contentHash,
      byteCount: stored.byteCount,
      mediaType: "text/plain; charset=utf-8",
    },
    replyToEventId: null,
    signalCode: null,
    automationDepth: 0,
    occurredAt: "2026-10-05T08:00:00.000Z",
  });
}

const agentTurn = {
  role: "assistant" as const,
  text: "I parked the WSL worker so only the Mac writes.",
  speaker: {
    kind: "agent" as const,
    participantId: "ptc_lervoagent",
    agentId: `agt_${"a".repeat(24)}`,
    roleId: "developer",
  },
};

describe("conversation owner-turn capture (ADR-0467, ADR-0457 conversation_decision source)", () => {
  it("queues a human participant's message with the preceding agent reply", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-capture-"));
    roots.push(root);
    const artifacts = memoryArtifacts();
    const capture = createConversationOwnerTurnCapture({
      repositoryRoot: root,
      artifactStore: artifacts,
    });
    const message = "그렇게 하지 말고, 두 호스트 모두 계속 쓰게 해.";
    const event = await inbound(
      artifacts,
      message,
      { kind: "human", participantId: "ptc_owner0001", roleId: null },
      "cevt_owner",
    );
    await capture.capture({
      event,
      priorTurns: [agentTurn],
      respondingAgentId: agentTurn.speaker.agentId,
    });
    await capture.capture({ event, priorTurns: [agentTurn], respondingAgentId: null });
    const queued = await listQueuedInstructionCaptures(root);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({
      source: "conversation",
      provider: null,
      ownerTurn: message,
      precedingAgentTurn: agentTurn.text,
      conversation: { conversationEventId: event.eventId, agentId: agentTurn.speaker.agentId },
    });
  });

  it("ignores agent messages, which are not owner turns", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-capture-"));
    roots.push(root);
    const artifacts = memoryArtifacts();
    const capture = createConversationOwnerTurnCapture({
      repositoryRoot: root,
      artifactStore: artifacts,
    });
    const event = await inbound(
      artifacts,
      "From now on I will review every pull request.",
      { kind: "agent", participantId: "ptc_lervoagent", roleId: "developer" },
      "cevt_agent",
    );
    await capture.capture({ event, priorTurns: [], respondingAgentId: null });
    expect(await listQueuedInstructionCaptures(root)).toEqual([]);
  });

  it("is invoked by the managed conversation responder before the turn resolves", async () => {
    const artifacts = memoryArtifacts();
    const captured = vi.fn(async () => undefined);
    const resolve_ = vi.fn<ConversationIntentResolver["resolve"]>(async () => ({
      intent: "answer",
      confidence: "high" as const,
      participation: "relevant" as const,
      effect: { kind: "none" as const },
      provider: { providerId: "codex", model: null, adapterVersion: "2" as const },
      resultDigest: `sha256:${"e".repeat(64)}`,
    }));
    const reply = async () => {
      const bytes = new TextEncoder().encode("Understood.");
      await artifacts.put(bytes);
      return {
        content: { contentHash: hash(bytes), byteCount: bytes.byteLength },
      } as Awaited<ReturnType<ConversationResponder["respond"]>>;
    };
    const responder = new NaturalLanguageDiscordConversationResponder({
      applicationId: "999999999999999999",
      respondingAgent: {
        participantId: "ptc_lervoagent",
        agentId: agentTurn.speaker.agentId,
        roleId: "developer",
      },
      repositoryRoot: process.cwd(),
      artifactStore: artifacts,
      history: { recent: async () => [agentTurn] },
      resolutionStore: { read: async () => null, record: async () => undefined },
      intentResolver: { resolve: resolve_ },
      participationPolicy: createConversationParticipationPolicy({
        projectId: "prj_test0001",
        roleId: "developer",
        conversationIds: ["cnv_test0001"],
        mode: "relevant",
        respondTo: ["human"],
        signalCodes: [],
        cooldownSeconds: 0,
        maxResponsesPerHour: 8,
        maxAutomationDepth: 2,
        createdAt: "2026-10-05T07:00:00.000Z",
      }),
      readOnly: { respond: vi.fn(reply) } as ConversationResponder,
      continuation: { respond: vi.fn(reply) } as ConversationResponder,
      availableEffects: ["none"],
      platformAction: {
        availableEffects: ["none"],
        managedResultEffects: [],
        respond: vi.fn(reply),
      } as never,
      ownerTurnCapture: { capture: captured },
    });
    const event = await inbound(
      artifacts,
      "Keep both hosts working.",
      { kind: "human", participantId: "ptc_owner0001", roleId: null },
      "cevt_wired",
    );
    await responder.respond({ event } as Parameters<ConversationResponder["respond"]>[0]);
    expect(captured).toHaveBeenCalledWith({
      event,
      priorTurns: [agentTurn],
      respondingAgentId: agentTurn.speaker.agentId,
    });
  });
});
