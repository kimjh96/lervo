import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import {
  createConversationInboundEvent,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import type { ConversationInboundEvent } from "@lervo/schemas";
import { describe, expect, it, vi } from "vitest";

import { ConversationTaskDelegateResponder } from "../src/conversation-task-delegate-responder.js";
import type { ConversationPeerTurnRequest } from "../src/conversation-peer-turn-router.js";
import type { DiscordPeerAgentBinding } from "../src/discord-conversation-composition.js";
import { removeTemporaryRoots, temporaryRoot } from "./fixture.js";

function researcher(): DiscordPeerAgentBinding {
  return {
    participantId: "ptc_peer_researcher0001",
    roleId: "researcher",
    conversationIds: ["cnv_test0001"],
    displayName: "Rhea",
  } as DiscordPeerAgentBinding;
}

async function sourceEvent(
  artifactStore: Awaited<ReturnType<typeof FileSystemCas.open>>,
  message: string,
): Promise<ConversationInboundEvent> {
  const source = await artifactStore.put(message);
  return createConversationInboundEvent({
    sourceEventKeyHash: hashConversationSourceEventKey("discord-delegate-1"),
    target: {
      integrationId: "itg_discord01",
      projectId: "prj_test0001",
      conversationId: "cnv_test0001",
      threadId: null,
    },
    kind: "message.created",
    actor: { kind: "human", participantId: "ptc_owner0001", roleId: null },
    mentions: { participantIds: [], roleIds: [] },
    content: {
      artifactId: `art_${source.contentHash.slice(7)}`,
      contentHash: source.contentHash,
      byteCount: source.byteCount,
      mediaType: "text/plain; charset=utf-8",
    },
    replyToEventId: null,
    signalCode: null,
    automationDepth: 0,
    occurredAt: "2026-09-16T00:00:00.000Z",
  });
}

function responderFor(
  artifactStore: Awaited<ReturnType<typeof FileSystemCas.open>>,
  dispatch: (request: ConversationPeerTurnRequest) => Promise<"accepted" | "not_registered">,
  peers: readonly DiscordPeerAgentBinding[] = [researcher()],
) {
  return new ConversationTaskDelegateResponder({
    artifactStore,
    parentParticipantId: "ptc_agent_owner0001",
    parentRoleId: "product-owner",
    parentAgentBinding: {
      agentId: `agt_${"a".repeat(24)}`,
      roleVersion: "1.0.0",
      roleContractHash: `sha256:${"b".repeat(64)}`,
      roleProfileHash: `sha256:${"c".repeat(64)}`,
    },
    peers,
    dispatcher: { dispatch },
    now: () => new Date("2026-09-16T00:00:01.000Z"),
  });
}

describe("conversation task delegate responder", () => {
  it("addresses the hired agent so the delegated turn runs in its own context", async () => {
    const root = await temporaryRoot();
    const artifactStore = await FileSystemCas.open(resolve(root, "artifacts"));
    const event = await sourceEvent(artifactStore, "이 리서치는 우리 리서처에게 맡기세요.");
    const dispatched: ConversationPeerTurnRequest[] = [];
    const dispatch = vi.fn(async (next: ConversationPeerTurnRequest) => {
      dispatched.push(next);
      return "accepted" as const;
    });
    const reply = await responderFor(artifactStore, dispatch).respond(
      { event } as Parameters<ConversationTaskDelegateResponder["respond"]>[0],
      {
        kind: "workforce_task_delegate",
        specification: JSON.stringify({
          participantId: "ptc_peer_researcher0001",
          task: "경쟁 제품의 최신 가격 정책을 조사해 주세요.",
        }),
      },
      { effectRequesterAuthorized: true },
    );

    expect(dispatch).toHaveBeenCalledTimes(1);
    const delegated = dispatched[0]!;
    expect(delegated.targetParticipantId).toBe("ptc_peer_researcher0001");
    expect(delegated.sourceActor).toMatchObject({
      kind: "agent",
      participantId: "ptc_agent_owner0001",
      roleId: "product-owner",
    });
    expect(delegated.sourceEvent).toBe(event);
    expect(delegated.task).toBe("경쟁 제품의 최신 가격 정책을 조사해 주세요.");
    expect(delegated.task).not.toContain("위임받은 담당 에이전트");
    const bytes = await artifactStore.get(
      `lervo-cas://sha256/${reply.content.contentHash.slice(7)}`,
    );
    expect(new TextDecoder().decode(bytes)).toContain("Rhea");
    await removeTemporaryRoots();
  });

  it("keeps a bounded chain and refuses unauthorized, malformed, or unreachable delegation", async () => {
    const root = await temporaryRoot();
    const artifactStore = await FileSystemCas.open(resolve(root, "artifacts"));
    const event = await sourceEvent(artifactStore, "Delegate this research.");
    const dispatch = vi.fn(async () => "accepted" as const);
    const responder = responderFor(artifactStore, dispatch);
    const delegate = (specification: string, effectRequesterAuthorized = true) =>
      responder.respond(
        { event } as Parameters<ConversationTaskDelegateResponder["respond"]>[0],
        { kind: "workforce_task_delegate", specification },
        { effectRequesterAuthorized },
      );
    const valid = JSON.stringify({
      participantId: "ptc_peer_researcher0001",
      task: "Survey competitor pricing.",
    });

    await expect(delegate(valid, false)).rejects.toThrow("not authorized");
    await expect(delegate("not json")).rejects.toThrow("not valid JSON");
    await expect(
      delegate(JSON.stringify({ participantId: "ptc_peer_researcher0001" })),
    ).rejects.toThrow("exactly one target");
    await expect(
      delegate(
        JSON.stringify({ participantId: "ptc_missing0001", task: "Survey competitor pricing." }),
      ),
    ).rejects.toThrow("exact target");
    expect(dispatch).not.toHaveBeenCalled();

    // A hired agent that does not participate in this conversation is unreachable here.
    const elsewhere = { ...researcher(), conversationIds: ["cnv_other0001"] };
    await expect(
      responderFor(artifactStore, dispatch, [elsewhere]).respond(
        { event } as Parameters<ConversationTaskDelegateResponder["respond"]>[0],
        { kind: "workforce_task_delegate", specification: valid },
        { effectRequesterAuthorized: true },
      ),
    ).rejects.toThrow("No hired agent");

    // A chain already at the reviewed bound is rejected before dispatch.
    const deep = { ...event, automationDepth: 8 };
    const boundedDispatcher = {
      dispatch: vi.fn(async (request: ConversationPeerTurnRequest) => {
        if (request.sourceEvent.automationDepth >= 8) throw new Error("automation bound");
        return "accepted" as const;
      }),
    };
    const bounded = new ConversationTaskDelegateResponder({
      artifactStore,
      parentParticipantId: "ptc_agent_owner0001",
      parentRoleId: "product-owner",
      parentAgentBinding: {
        agentId: `agt_${"a".repeat(24)}`,
        roleVersion: "1.0.0",
        roleContractHash: `sha256:${"b".repeat(64)}`,
        roleProfileHash: `sha256:${"c".repeat(64)}`,
      },
      peers: [researcher()],
      dispatcher: boundedDispatcher,
    });
    await expect(
      bounded.respond(
        { event: deep } as Parameters<ConversationTaskDelegateResponder["respond"]>[0],
        { kind: "workforce_task_delegate", specification: valid },
        { effectRequesterAuthorized: true },
      ),
    ).rejects.toThrow("automation bound");
    await removeTemporaryRoots();
  });

  it("selects an exact named agent when more than one peer has the same role", async () => {
    const root = await temporaryRoot();
    const artifactStore = await FileSystemCas.open(resolve(root, "artifacts"));
    const event = await sourceEvent(artifactStore, "Ask Rhea, not the other researcher.");
    const peers = [
      researcher(),
      {
        ...researcher(),
        participantId: "ptc_peer_researcher0002",
        displayName: "Rowan",
      },
    ];
    const dispatch = vi.fn(async () => "accepted" as const);
    const responder = responderFor(artifactStore, dispatch, peers);

    await responder.respond(
      { event } as Parameters<ConversationTaskDelegateResponder["respond"]>[0],
      {
        kind: "workforce_task_delegate",
        specification: JSON.stringify({
          participantId: "ptc_peer_researcher0001",
          task: "Review the routing evidence.",
        }),
      },
      { effectRequesterAuthorized: true },
    );
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ targetParticipantId: "ptc_peer_researcher0001" }),
    );
    await expect(
      responder.respond(
        { event } as Parameters<ConversationTaskDelegateResponder["respond"]>[0],
        {
          kind: "workforce_task_delegate",
          specification: JSON.stringify({
            roleId: "researcher",
            task: "Review the routing evidence.",
          }),
        },
        { effectRequesterAuthorized: true },
      ),
    ).rejects.toThrow("use an exact participantId");
    await removeTemporaryRoots();
  });

  it("publishes one exact addressed task when the peer runs on another Node", async () => {
    const root = await temporaryRoot();
    const artifactStore = await FileSystemCas.open(resolve(root, "artifacts"));
    const event = await sourceEvent(artifactStore, "Ask the remote researcher.");
    const remote = {
      ...researcher(),
      participantKeys: ["bot:999999999999999992"],
    };
    const reply = await responderFor(artifactStore, async () => "not_registered", [remote]).respond(
      { event } as Parameters<ConversationTaskDelegateResponder["respond"]>[0],
      {
        kind: "workforce_task_delegate",
        specification: JSON.stringify({
          participantId: "ptc_peer_researcher0001",
          task: "Survey competitor pricing.",
        }),
      },
      { effectRequesterAuthorized: true },
    );
    const bytes = await artifactStore.get(
      `lervo-cas://sha256/${reply.content.contentHash.slice(7)}`,
    );
    const content = new TextDecoder().decode(bytes);
    expect(content).toBe("<@999999999999999992> Survey competitor pricing.");
    expect(reply.audienceParticipation).toBe("eligible");
    expect(reply.coordination).toMatchObject({
      kind: "task.assignment",
      coordinatorParticipantId: "ptc_agent_owner0001",
    });
  });
});
