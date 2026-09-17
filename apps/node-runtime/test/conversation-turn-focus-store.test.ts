import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  createConversationInboundEvent,
  createConversationParticipationPolicy,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import { afterEach, describe, expect, it } from "vitest";

import { SQLiteConversationTurnFocusStore } from "../src/conversation-turn-focus-store.js";
import type { DiscordPeerAgentBinding } from "../src/discord-conversation-composition.js";
import { createDiscordConversationTurnOwnership } from "../src/discord-conversation-turn-ownership.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const agents = [
  { participantId: "ptc_agent0001", roleId: "product-owner" },
  { participantId: "ptc_agent0002", roleId: "researcher" },
  { participantId: "ptc_agent0003", roleId: "developer" },
] as const;

function peer(index: number): DiscordPeerAgentBinding {
  const agent = agents[index]!;
  return {
    participantKeys: [`bot:${index + 1}`],
    participantId: agent.participantId,
    roleId: agent.roleId,
    agentBinding: {
      agentId: `agt_${String(index + 1).repeat(24)}`,
      roleVersion: "1.0.0",
      roleContractHash: `sha256:${String(index + 1).repeat(64)}`,
      roleProfileHash: `sha256:${String(index + 4).repeat(64)}`,
    },
    tenantKeys: ["tenant-1"],
    conversationIds: ["cnv_general01"],
  };
}

function ownership(
  index: number,
  active: readonly number[],
  focusStore: SQLiteConversationTurnFocusStore,
) {
  return createDiscordConversationTurnOwnership({
    participantId: agents[index]!.participantId,
    roleId: agents[index]!.roleId,
    conversationIds: ["cnv_general01"],
    peers: active.filter((candidate) => candidate !== index).map(peer),
    focusStore,
  });
}

function event(input: {
  integrationId: string;
  source: string;
  at: string;
  participantIds?: string[];
  actor?: { kind: "human"; participantId: string } | { kind: "agent"; index: number };
}) {
  const actor = input.actor ?? { kind: "human" as const, participantId: "ptc_human001" };
  return createConversationInboundEvent({
    sourceEventKeyHash: hashConversationSourceEventKey(input.source),
    target: {
      integrationId: input.integrationId,
      projectId: "prj_project01",
      conversationId: "cnv_general01",
      threadId: null,
    },
    kind: "message.created",
    actor:
      actor.kind === "human"
        ? { kind: "human", participantId: actor.participantId, roleId: null }
        : {
            kind: "agent",
            participantId: agents[actor.index]!.participantId,
            roleId: agents[actor.index]!.roleId,
            agentBinding: peer(actor.index).agentBinding,
          },
    content: {
      artifactId: `art_${"a".repeat(64)}`,
      contentHash: `sha256:${"b".repeat(64)}`,
      byteCount: 12,
      mediaType: "text/plain; charset=utf-8",
    },
    mentions: { roleIds: [], participantIds: input.participantIds ?? [] },
    replyToEventId: null,
    signalCode: null,
    automationDepth: actor.kind === "human" ? 0 : 1,
    occurredAt: input.at,
  });
}

function policy(index: number) {
  return createConversationParticipationPolicy({
    projectId: "prj_project01",
    roleId: agents[index]!.roleId,
    conversationIds: ["cnv_general01"],
    mode: "relevant",
    respondTo: ["human", "agent"],
    signalCodes: [],
    cooldownSeconds: 0,
    maxResponsesPerHour: 8,
    maxAutomationDepth: 2,
    createdAt: "2026-09-17T00:00:00.000Z",
  });
}

async function storePath(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-turn-focus-"));
  roots.push(root);
  return resolve(root, "turn-focus.sqlite");
}

describe("durable conversation turn focus", () => {
  it("retains the human's explicitly addressed interlocutor after restart and hiring", async () => {
    const path = await storePath();
    let store = await SQLiteConversationTurnFocusStore.open(path);
    const beforeRestart = [ownership(0, [0, 1], store), ownership(1, [0, 1], store)];
    for (const [index, evaluator] of beforeRestart.entries()) {
      evaluator.owns({
        event: event({
          integrationId: `itg_agent000${index + 1}`,
          source: "address-researcher",
          at: "2026-09-17T00:00:00.000Z",
          participantIds: [agents[1].participantId],
        }),
        policy: policy(index),
      });
    }
    store.close();

    store = await SQLiteConversationTurnFocusStore.open(path);
    const afterHiring = [0, 1, 2].map((index) => ownership(index, [0, 1, 2], store));
    const responses = afterHiring.map((evaluator, index) =>
      evaluator.owns({
        event: event({
          integrationId: `itg_agent000${index + 1}`,
          source: "follow-up-after-hiring",
          at: "2026-09-17T00:05:00.000Z",
        }),
        policy: policy(index),
      }),
    );

    expect(responses).toEqual([false, true, false]);
    store.close();
  });

  it("falls back to one deterministic owner when the focused participant is no longer active", async () => {
    const store = await SQLiteConversationTurnFocusStore.open(await storePath());
    store.write({
      projectId: "prj_project01",
      conversationId: "cnv_general01",
      threadId: null,
      participantId: agents[1].participantId,
      lastEventAt: "2026-09-17T00:00:00.000Z",
      lastSourceEventKeyHash: hashConversationSourceEventKey("address-researcher"),
    });
    const active = [0, 2];
    const responses = active.map((index) =>
      ownership(index, active, store).owns({
        event: event({
          integrationId: `itg_agent000${index + 1}`,
          source: "follow-up-after-retirement",
          at: "2026-09-17T00:05:00.000Z",
        }),
        policy: policy(index),
      }),
    );

    expect(responses.filter(Boolean)).toHaveLength(1);
    expect(
      store.read({
        projectId: "prj_project01",
        conversationId: "cnv_general01",
        threadId: null,
      }),
    ).toBeNull();
    store.close();
  });

  it("does not let an agent-authored address steal the human interlocutor focus", async () => {
    const store = await SQLiteConversationTurnFocusStore.open(await storePath());
    store.write({
      projectId: "prj_project01",
      conversationId: "cnv_general01",
      threadId: null,
      participantId: agents[1].participantId,
      lastEventAt: "2026-09-17T00:00:00.000Z",
      lastSourceEventKeyHash: hashConversationSourceEventKey("human-address"),
    });
    ownership(0, [0, 1], store).owns({
      event: event({
        integrationId: "itg_agent0001",
        source: "agent-address",
        at: "2026-09-17T00:01:00.000Z",
        participantIds: [agents[0].participantId],
        actor: { kind: "agent", index: 1 },
      }),
      policy: policy(0),
    });

    expect(
      ownership(1, [0, 1], store).owns({
        event: event({
          integrationId: "itg_agent0002",
          source: "human-follow-up",
          at: "2026-09-17T00:02:00.000Z",
        }),
        policy: policy(1),
      }),
    ).toBe(true);
    store.close();
  });

  it("does not let an older replay replace newer focus", async () => {
    const store = await SQLiteConversationTurnFocusStore.open(await storePath());
    store.write({
      projectId: "prj_project01",
      conversationId: "cnv_general01",
      threadId: null,
      participantId: agents[1].participantId,
      lastEventAt: "2026-09-17T00:10:00.000Z",
      lastSourceEventKeyHash: hashConversationSourceEventKey("newer"),
    });
    store.write({
      projectId: "prj_project01",
      conversationId: "cnv_general01",
      threadId: null,
      participantId: agents[0].participantId,
      lastEventAt: "2026-09-17T00:00:00.000Z",
      lastSourceEventKeyHash: hashConversationSourceEventKey("older"),
    });

    expect(
      store.read({
        projectId: "prj_project01",
        conversationId: "cnv_general01",
        threadId: null,
      })?.participantId,
    ).toBe(agents[1].participantId);
    store.close();
  });

  it("fails closed when one source event resolves to conflicting participants", async () => {
    const store = await SQLiteConversationTurnFocusStore.open(await storePath());
    const coordinate = {
      projectId: "prj_project01",
      conversationId: "cnv_general01",
      threadId: null,
      lastEventAt: "2026-09-17T00:00:00.000Z",
      lastSourceEventKeyHash: hashConversationSourceEventKey("same-event"),
    };
    store.write({ ...coordinate, participantId: agents[0].participantId });

    expect(() => store.write({ ...coordinate, participantId: agents[1].participantId })).toThrow(
      /conflicting focused participants/,
    );
    store.close();
  });
});
