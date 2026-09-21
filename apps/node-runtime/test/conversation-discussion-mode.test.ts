import { createHash } from "node:crypto";

import {
  createConversationInboundEvent,
  createConversationParticipationPolicy,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import type { ConversationResponder } from "@lervo/interaction";
import type { ArtifactStore } from "@lervo/storage-contract";
import { describe, expect, it, vi } from "vitest";

import type { ConversationDiscussionRuntime } from "../src/conversation-discussion-runtime.js";
import { NaturalLanguageDiscordConversationResponder } from "../src/discord-conversation-mode.js";

const discussionId = "dsc_abcdefghijklmnopqrst";

function event(kind: "discussion.assignment" | "discussion.contribution") {
  return createConversationInboundEvent({
    sourceEventKeyHash: hashConversationSourceEventKey(kind),
    target: {
      integrationId: "itg_discussion01",
      projectId: "prj_discussion01",
      conversationId: "cnv_discussion01",
      threadId: null,
    },
    kind: "message.created",
    actor: {
      kind: "agent",
      participantId: "ptc_peeragent01",
      roleId: "product-owner",
      agentBinding: {
        agentId: `agt_${"a".repeat(24)}`,
        roleVersion: "1.0.0",
        roleContractHash: `sha256:${"b".repeat(64)}`,
        roleProfileHash: `sha256:${"c".repeat(64)}`,
      },
    },
    content: {
      artifactId: "art_discussion01",
      contentHash: `sha256:${"d".repeat(64)}`,
      byteCount: 10,
      mediaType: "text/plain; charset=utf-8",
    },
    coordination: { kind, discussionId },
    mentions: { roleIds: [], participantIds: ["ptc_currentagent01"] },
    replyToEventId: `cve_${"e".repeat(64)}`,
    signalCode: null,
    automationDepth: 1,
    occurredAt: "2026-09-18T05:00:00.000Z",
  });
}

const artifacts: ArtifactStore = {
  put: async () => {
    throw new Error("not used");
  },
  putStream: async () => {
    throw new Error("not used");
  },
  get: async () => new Uint8Array(),
  has: async () => false,
};

function memoryArtifacts(): ArtifactStore {
  const entries = new Map<string, Uint8Array>();
  const put = async (content: string | Uint8Array) => {
    const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : content;
    const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const uri = `lervo-cas://sha256/${contentHash.slice("sha256:".length)}`;
    const created = !entries.has(uri);
    entries.set(uri, new Uint8Array(bytes));
    return { uri, contentHash, byteCount: bytes.byteLength, created };
  };
  return {
    put,
    putStream: async (chunks) => {
      const parts: Uint8Array[] = [];
      for await (const chunk of chunks) {
        parts.push(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
      }
      return put(Buffer.concat(parts));
    },
    get: async (uri) => new Uint8Array(entries.get(uri) ?? []),
    has: async (uri) => entries.has(uri),
  };
}

function reply() {
  return {
    content: {
      artifactId: "art_reply0001",
      contentHash: `sha256:${"f".repeat(64)}`,
      byteCount: 10,
      mediaType: "text/plain; charset=utf-8",
    },
    publicationPermit: {},
    publicationEvidence: {},
  } as unknown as Awaited<ReturnType<ConversationResponder["respond"]>>;
}

describe("natural discussion conversation mode", () => {
  it("publishes the next serialized assignment without another provider call", async () => {
    const readOnly = { respond: vi.fn(async () => reply()) };
    const discussion = {
      directive: vi.fn(async () => ({
        kind: "next_assignment" as const,
        discussionId,
        activeParticipantId: "ptc_currentagent01",
        content: "<@999999999999999998> <@999999999999999997>\n\n다음 독립 검토입니다.",
      })),
    } as unknown as ConversationDiscussionRuntime;
    const responder = new NaturalLanguageDiscordConversationResponder({
      applicationId: "999999999999999999",
      respondingAgent: {
        participantId: "ptc_currentagent01",
        agentId: `agt_${"9".repeat(24)}`,
        roleId: "ceo",
      },
      repositoryRoot: process.cwd(),
      artifactStore: memoryArtifacts(),
      history: { recent: async () => [] },
      resolutionStore: { read: async () => null, record: async () => undefined },
      participationPolicy: createConversationParticipationPolicy({
        projectId: "prj_discussion01",
        roleId: "ceo",
        conversationIds: ["cnv_discussion01"],
        mode: "relevant",
        respondTo: ["agent"],
        signalCodes: [],
        cooldownSeconds: 0,
        maxResponsesPerHour: 8,
        maxAutomationDepth: 8,
        createdAt: "2026-09-18T00:00:00.000Z",
      }),
      readOnly: readOnly as ConversationResponder,
      continuation: readOnly as ConversationResponder,
      platformAction: { availableEffects: [], respond: vi.fn() },
      discussion,
    });

    const candidate = await responder.respond({
      event: event("discussion.contribution"),
      policy: {} as never,
      decision: {} as never,
    });
    expect(readOnly.respond).not.toHaveBeenCalled();
    expect(candidate.coordination).toEqual({
      kind: "discussion.assignment",
      discussionId,
      activeParticipantId: "ptc_currentagent01",
      assignmentSequence: 2,
    });
    expect(candidate.audienceParticipation).toBe("eligible");
    await expect(
      responder.usesFixedDiscussionPublicationContract(event("discussion.contribution")),
    ).resolves.toBe(true);
  });

  it.each([
    {
      inputKind: "discussion.assignment" as const,
      directive: {
        kind: "assignment" as const,
        discussionId,
        executionProfile: "review" as const,
      },
      outputKind: "discussion.contribution" as const,
      profile: "review",
      audience: undefined,
    },
    {
      inputKind: "discussion.contribution" as const,
      directive: {
        kind: "decision" as const,
        discussionId,
        executionProfile: "reasoning" as const,
        priorTurns: [],
        terminalState: "converged" as const,
      },
      outputKind: "discussion.decision" as const,
      profile: "reasoning",
      audience: "observe_only",
    },
  ])("routes $inputKind through the real-agent response profile", async (fixture) => {
    const readOnly = { respond: vi.fn(async () => reply()) };
    const markConverged = vi.fn();
    const markFailed = vi.fn();
    const discussion = {
      directive: vi.fn(async () => fixture.directive),
      markConverged,
      markFailed,
    } as unknown as ConversationDiscussionRuntime;
    const responder = new NaturalLanguageDiscordConversationResponder({
      applicationId: "999999999999999999",
      respondingAgent: {
        participantId: "ptc_currentagent01",
        agentId: `agt_${"9".repeat(24)}`,
        roleId: "ceo",
      },
      repositoryRoot: process.cwd(),
      artifactStore: artifacts,
      history: { recent: async () => [] },
      resolutionStore: { read: async () => null, record: async () => undefined },
      participationPolicy: createConversationParticipationPolicy({
        projectId: "prj_discussion01",
        roleId: "ceo",
        conversationIds: ["cnv_discussion01"],
        mode: "relevant",
        respondTo: ["agent"],
        signalCodes: [],
        cooldownSeconds: 0,
        maxResponsesPerHour: 8,
        maxAutomationDepth: 8,
        createdAt: "2026-09-18T00:00:00.000Z",
      }),
      readOnly: readOnly as ConversationResponder,
      continuation: readOnly as ConversationResponder,
      platformAction: { availableEffects: [], respond: vi.fn() },
      discussion,
    });
    const inbound = event(fixture.inputKind);
    await expect(responder.evaluate({ event: inbound, policy: {} as never })).resolves.toBe(
      "relevant",
    );
    const candidate = await responder.respond({
      event: inbound,
      policy: {} as never,
      decision: {} as never,
    });
    expect(readOnly.respond).toHaveBeenCalledWith(
      expect.objectContaining({
        context: expect.objectContaining({ executionProfile: fixture.profile }),
      }),
    );
    expect(candidate.coordination).toEqual({ kind: fixture.outputKind, discussionId });
    expect(candidate.audienceParticipation).toBe(fixture.audience);
    await expect(responder.usesFixedDiscussionPublicationContract(inbound)).resolves.toBe(false);
    expect(markConverged).toHaveBeenCalledTimes(
      fixture.outputKind === "discussion.decision" ? 1 : 0,
    );
  });
});
