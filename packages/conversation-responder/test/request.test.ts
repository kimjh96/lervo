import { createConversationInboundEvent } from "@lervo/conversation-contract";
import type { ManagedConversationResponseRequest } from "@lervo/conversation-responder";
import { describe, expect, it } from "vitest";

import { conversationResponseInstructions } from "../src/request.js";

const hash = `sha256:${"a".repeat(64)}`;
const agentBinding = {
  agentId: "agt_111111111111111111111111",
  roleVersion: "1.0.0",
  roleContractHash: hash,
  roleProfileHash: hash,
};

function request(kind: "discussion.assignment" | "discussion.contribution") {
  const event = createConversationInboundEvent({
    sourceEventKeyHash: hash,
    target: {
      integrationId: "itg_discord01",
      projectId: "prj_conversation01",
      conversationId: "cnv_general01",
      threadId: null,
    },
    kind: "message.created",
    actor: {
      kind: "agent",
      participantId: "ptc_current01",
      roleId: "reviewer",
      agentBinding,
    },
    content: {
      artifactId: "art_message01",
      contentHash: hash,
      byteCount: 7,
      mediaType: "text/plain; charset=utf-8",
    },
    coordination: {
      kind,
      discussionId: "dsc_12345678901234567890",
      ...(kind === "discussion.assignment"
        ? { activeParticipantId: "ptc_current01", assignmentSequence: 1 as const }
        : {}),
    },
    mentions: { roleIds: [], participantIds: [] },
    replyToEventId: null,
    signalCode: null,
    automationDepth: 1,
    occurredAt: "2026-09-18T10:00:00.000Z",
  });
  return {
    event,
    policy: { roleId: "reviewer" },
    decision: {},
    context: {
      priorTurns: [
        {
          role: "assistant" as const,
          text: "Earlier contribution",
          speaker: {
            kind: "agent" as const,
            participantId: "ptc_earlier01",
            agentId: "agt_222222222222222222222222",
            roleId: "reviewer",
          },
        },
      ],
    },
  } as unknown as ManagedConversationResponseRequest;
}

function completedEffectRequest(): ManagedConversationResponseRequest {
  const base = request("discussion.assignment");
  return {
    ...base,
    context: {
      priorTurns: [],
      completedEffect: {
        effectId: "requested_runtime_open",
        resultCode: "opened",
        targetLabel: "Development server",
        facts: ["The configured runtime started successfully."],
      },
    },
  };
}

describe("conversation response instructions", () => {
  it("marks assignment isolation as intentional", () => {
    const parsed = JSON.parse(
      conversationResponseInstructions(request("discussion.assignment"), "Independent review", {
        agentId: agentBinding.agentId,
        provider: "codex",
        requestedModel: "gpt-test",
      }),
    ) as { requirements: string[]; messageSpeaker: { participantId: string } };

    expect(parsed.messageSpeaker.participantId).toBe("ptc_current01");
    expect(parsed.requirements.join("\n")).toContain(
      "empty priorTurns list is intentional isolation",
    );
    expect(parsed.requirements.join("\n")).toContain("do not assert that an old failure");
  });

  it("keeps synthesis speakers distinct and rejects stale status as discussion evidence", () => {
    const parsed = JSON.parse(
      conversationResponseInstructions(request("discussion.contribution"), "Current contribution", {
        agentId: agentBinding.agentId,
        provider: "codex",
        requestedModel: "gpt-test",
      }),
    ) as {
      requirements: string[];
      messageSpeaker: { participantId: string };
      priorTurns: Array<{ speaker: { participantId: string } }>;
    };

    expect(parsed.messageSpeaker.participantId).toBe("ptc_current01");
    expect(parsed.priorTurns[0]?.speaker.participantId).toBe("ptc_earlier01");
    expect(parsed.requirements.join("\n")).toContain(
      "never merge two participant or agent identities",
    );
    expect(parsed.requirements.join("\n")).toContain("must not be presented as current discussion");
  });

  it("grounds a natural follow-up in the completed action instead of exposing routing", () => {
    const parsed = JSON.parse(
      conversationResponseInstructions(completedEffectRequest(), "서버 띄워줘", {
        agentId: agentBinding.agentId,
        provider: "codex",
        requestedModel: "gpt-test",
      }),
    ) as {
      requirements: string[];
      completedEffect: { targetLabel: string; resultCode: string };
    };

    expect(parsed.completedEffect).toEqual(
      expect.objectContaining({ targetLabel: "Development server", resultCode: "opened" }),
    );
    expect(parsed.requirements.join("\n")).toContain("action that already ran");
    expect(parsed.requirements.join("\n")).toContain("Do not expose effect IDs");
  });
});
