import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import {
  createConversationInboundEvent,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import type { ConversationInboundEvent } from "@lervo/schemas";
import { describe, expect, it, vi } from "vitest";

import { ConversationTaskDelegateResponder } from "../src/conversation-task-delegate-responder.js";
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
  dispatch: (event: ConversationInboundEvent) => Promise<void>,
  peers: readonly DiscordPeerAgentBinding[] = [researcher()],
) {
  return new ConversationTaskDelegateResponder({
    artifactStore,
    integrationId: "itg_discord01",
    projectId: "prj_test0001",
    parentParticipantId: "ptc_agent_owner0001",
    parentRoleId: "product-owner",
    peers,
    dispatch,
    now: () => new Date("2026-09-16T00:00:01.000Z"),
  });
}

describe("conversation task delegate responder", () => {
  it("addresses the hired agent so the delegated turn runs in its own context", async () => {
    const root = await temporaryRoot();
    const artifactStore = await FileSystemCas.open(resolve(root, "artifacts"));
    const event = await sourceEvent(artifactStore, "이 리서치는 우리 리서처에게 맡기세요.");
    const dispatched: ConversationInboundEvent[] = [];
    const dispatch = vi.fn(async (next: ConversationInboundEvent) => {
      dispatched.push(next);
    });
    const reply = await responderFor(artifactStore, dispatch).respond(
      { event } as Parameters<ConversationTaskDelegateResponder["respond"]>[0],
      {
        kind: "workforce_task_delegate",
        specification: JSON.stringify({
          roleId: "researcher",
          task: "경쟁 제품의 최신 가격 정책을 조사해 주세요.",
        }),
      },
      { effectRequesterAuthorized: true },
    );

    expect(dispatch).toHaveBeenCalledTimes(1);
    const delegated = dispatched[0]!;
    // Only the exact participant address makes the ownership ladder select the hired agent.
    expect(delegated.mentions).toEqual({
      participantIds: ["ptc_peer_researcher0001"],
      roleIds: [],
    });
    expect(delegated.actor).toMatchObject({
      kind: "agent",
      participantId: "ptc_agent_owner0001",
      roleId: "product-owner",
    });
    expect(delegated.target).toMatchObject({ conversationId: "cnv_test0001", threadId: null });
    // The delegated turn continues the same automation chain instead of restarting it at zero.
    expect(delegated.automationDepth).toBe(1);
    const task = await artifactStore.get(
      `lervo-cas://sha256/${delegated.content.contentHash.slice(7)}`,
    );
    expect(new TextDecoder().decode(task)).toBe("경쟁 제품의 최신 가격 정책을 조사해 주세요.");
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
    const dispatch = vi.fn(async () => {});
    const responder = responderFor(artifactStore, dispatch);
    const delegate = (specification: string, effectRequesterAuthorized = true) =>
      responder.respond(
        { event } as Parameters<ConversationTaskDelegateResponder["respond"]>[0],
        { kind: "workforce_task_delegate", specification },
        { effectRequesterAuthorized },
      );
    const valid = JSON.stringify({ roleId: "researcher", task: "Survey competitor pricing." });

    await expect(delegate(valid, false)).rejects.toThrow("not authorized");
    await expect(delegate("not json")).rejects.toThrow("not valid JSON");
    await expect(delegate(JSON.stringify({ roleId: "researcher" }))).rejects.toThrow(
      "exactly roleId and task",
    );
    await expect(
      delegate(JSON.stringify({ roleId: "designer", task: "Survey competitor pricing." })),
    ).rejects.toThrow("No hired agent");
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

    // A chain already at the reviewed bound stays there instead of growing past it.
    const deep = { ...event, automationDepth: 8 };
    await responderFor(artifactStore, dispatch).respond(
      { event: deep } as Parameters<ConversationTaskDelegateResponder["respond"]>[0],
      { kind: "workforce_task_delegate", specification: valid },
      { effectRequesterAuthorized: true },
    );
    expect(dispatch).toHaveBeenCalledTimes(1);
    await removeTemporaryRoots();
  });
});
