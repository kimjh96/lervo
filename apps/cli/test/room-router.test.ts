import type { HostedDecodedEvent } from "@lervo/adapter-contract";
import { describe, expect, it } from "vitest";

import { EXCHANGE_LIMIT, RoomRouter, type RoomContext } from "../src/room-router.js";

const team = [
  { agentId: "agt_elio", displayName: "Elio", roleName: "Product Owner" },
  { agentId: "agt_ciel", displayName: "Ciel", roleName: "Developer" },
  { agentId: "agt_arin", displayName: "Arin", roleName: "Researcher" },
];

function context(agentId: string, sessions: Record<string, string>): RoomContext {
  return {
    workspaceId: "wsp_1",
    projectId: "prj_1",
    agentId,
    team,
    sessions: new Map(Object.entries(sessions)),
  };
}

function said(text: string): HostedDecodedEvent[] {
  return [
    { kind: "status", event: "turn_started" },
    { kind: "start", content: { kind: "agent_message", text: "" }, createdAtMs: 1 },
    { kind: "delta", text },
    { kind: "finish" },
    { kind: "status", event: "turn_finished" },
  ];
}

function owner(text: string): HostedDecodedEvent[] {
  return [{ kind: "item", content: { kind: "user_message", text }, createdAtMs: 1 }];
}

function router() {
  let id = 0;
  const room = new RoomRouter(
    () => 1_000_000,
    () => `dlv_${++id}`,
  );
  const sessions = { agt_elio: "s-elio", agt_ciel: "s-ciel" };
  room.know("s-elio", context("agt_elio", sessions));
  room.know("s-ciel", context("agt_ciel", sessions));
  return room;
}

describe("routing between a conversation's agents", () => {
  it("delivers mentions, shows them as the sender's, joins newcomers, and returns answers", () => {
    const room = router();
    expect(room.sent("s-elio", undefined, owner("Implement retries."))).toEqual(
      owner("Implement retries."),
    );

    const elio = room.observe("s-elio", said("@Ciel please implement retries."));
    expect(elio.deliveries).toEqual([
      expect.objectContaining({ deliveryId: "dlv_1", agentId: "agt_ciel", sessionId: "s-ciel" }),
    ]);
    const toCiel = elio.deliveries[0]?.text ?? "";
    expect(toCiel).toContain("[Lervo room] From Elio (Product Owner):");
    expect(toCiel).toContain("- Owner: Implement retries.");

    // The delivered turn shows as Elio's message, never as the owner's.
    expect(room.sent("s-ciel", "dlv_1", owner(toCiel))).toEqual([
      {
        kind: "item",
        content: { kind: "peer_message", from: "Elio", text: "@Ciel please implement retries." },
        createdAtMs: 1,
      },
    ]);

    // Asking Arin first keeps the answer to Elio owed; Arin, without a session, joins.
    const ciel = room.observe("s-ciel", said("Before I start: @Arin is Retry-After in seconds?"));
    expect(ciel.deliveries.map((item) => [item.agentId, item.sessionId])).toEqual([
      ["agt_arin", null],
    ]);
    expect(ciel.events.at(-1)).toMatchObject({
      content: {
        kind: "lervo_notice",
        code: "room_joined",
        parameters: { agent: "Arin", by: "Ciel" },
      },
    });

    room.know(
      "s-arin",
      context("agt_arin", { ...{ agt_elio: "s-elio", agt_ciel: "s-ciel" }, agt_arin: "s-arin" }),
    );
    room.sent("s-arin", "dlv_2", owner(ciel.deliveries[0]?.text ?? ""));
    const arin = room.observe("s-arin", said("Seconds, but the sandbox omits it."));
    expect(arin.deliveries.map((item) => item.agentId)).toEqual(["agt_ciel"]);
    expect(arin.deliveries[0]?.text).toContain("[Lervo room] Answer from Arin (Researcher):");

    room.sent("s-ciel", "dlv_3", owner(arin.deliveries[0]?.text ?? ""));
    const done = room.observe("s-ciel", said("Implemented with a 2 s default."));
    expect(done.deliveries.map((item) => item.agentId)).toEqual(["agt_elio"]);
  });

  it("takes naming the agent that asked as the answer, so the exchange ends there", () => {
    const room = router();
    room.know("s-arin", context("agt_arin", { agt_elio: "s-elio", agt_arin: "s-arin" }));
    room.sent("s-elio", undefined, owner("Check the capital."));
    const asked = room.observe("s-elio", said("@Arin what is the capital of Australia?"));
    room.sent("s-arin", asked.deliveries[0]?.deliveryId, []);
    const answered = room.observe("s-arin", said("@Elio, it is Canberra."));
    expect(answered.deliveries.map((item) => item.agentId)).toEqual(["agt_elio"]);
    expect(answered.deliveries[0]?.text).toContain("[Lervo room] Answer from Arin (Researcher):");
    room.sent("s-elio", answered.deliveries[0]?.deliveryId, []);
    // Elio owes Arin nothing, so telling the owner ends the exchange.
    expect(room.observe("s-elio", said("Arin says it is Canberra.")).deliveries).toEqual([]);
  });

  it("pauses at the exchange budget, asks the opener to summarize, and resumes on the owner's turn", () => {
    const room = router();
    room.sent("s-elio", undefined, owner("Discuss the plan."));
    let paused: ReturnType<RoomRouter["observe"]> | undefined;
    for (let turn = 0; turn <= EXCHANGE_LIMIT && paused === undefined; turn += 1) {
      const [session, mention] = turn % 2 === 0 ? ["s-elio", "@Ciel"] : ["s-ciel", "@Elio"];
      const answer = room.observe(session, said(`${mention} round ${turn}`));
      if (
        answer.events.some(
          (event) => event.kind === "item" && event.content.kind === "lervo_notice",
        )
      )
        paused = answer;
      else
        room.sent(session === "s-elio" ? "s-ciel" : "s-elio", answer.deliveries[0]?.deliveryId, []);
    }
    expect(paused?.events.at(-1)).toMatchObject({
      content: { code: "room_paused", parameters: { limit: EXCHANGE_LIMIT } },
    });
    expect(paused?.deliveries.map((item) => item.agentId)).toEqual(["agt_elio"]);
    expect(paused?.deliveries[0]?.text).toContain("Summarize the exchange for the owner");
    // While paused, mentions deliver nothing; the owner's turn opens a new exchange.
    expect(room.observe("s-ciel", said("@Elio one more")).deliveries).toEqual([]);
    room.sent("s-elio", undefined, owner("Go on."));
    expect(room.observe("s-elio", said("@Ciel continue")).deliveries).toHaveLength(1);
  });

  it("opens a conversation an agent started, which shows who started it and from where", () => {
    const room = router();
    const start = {
      workspaceId: "wsp_new",
      agentId: "agt_ciel",
      title: "Fix retry budget",
      text: "Fix the retry budget.",
      preparedAt: "2026-11-27T00:00:00.000Z",
    };
    // A start of another agent is never this session's to open.
    expect(room.starts("s-ciel", [{ ...start, agentId: "agt_elio" }]).deliveries).toEqual([]);
    const opened = room.starts("s-ciel", [start]);
    expect(opened.events).toMatchObject([
      {
        content: {
          kind: "lervo_notice",
          code: "conversation_started",
          parameters: { agent: "Ciel", title: "Fix retry budget", workspace: "wsp_new" },
        },
      },
    ]);
    expect(opened.deliveries).toMatchObject([
      { workspaceId: "wsp_new", agentId: "agt_ciel", sessionId: null },
    ]);
    const text = opened.deliveries[0]?.text ?? "";
    expect(text).toContain("[Lervo room] From Ciel (Developer):\nFix the retry budget.");
    expect(text).toContain("You started this conversation for this work, and you lead it.");

    // The new session's first turn echoes the delivery.
    room.know("s-new", { ...context("agt_ciel", {}), workspaceId: "wsp_new" });
    const shown = room.sent("s-new", opened.deliveries[0]?.deliveryId, owner(text));
    expect(shown.map((event) => (event.kind === "item" ? event.content : null))).toEqual([
      {
        kind: "lervo_notice",
        code: "conversation_started_by",
        parameters: { agent: "Ciel", workspace: "wsp_1" },
      },
      { kind: "peer_message", from: "Ciel", text: "Fix the retry budget." },
    ]);
  });

  it("hands a conversation it started to the teammate that leads it", () => {
    const room = router();
    const handed = room.starts("s-ciel", [
      {
        workspaceId: "wsp_handed",
        agentId: "agt_elio",
        startedBy: "agt_ciel",
        title: "Port the verifier",
        text: "Port the verifier.",
        preparedAt: "2026-11-27T00:00:00.000Z",
      },
    ]);
    // Ciel's turn delivers it, to Elio, who leads it.
    expect(handed.deliveries).toMatchObject([
      { workspaceId: "wsp_handed", agentId: "agt_elio", sessionId: null },
    ]);
    const text = handed.deliveries[0]?.text ?? "";
    expect(text).toContain("[Lervo room] From Ciel (Developer):\nPort the verifier.");
    expect(text).toContain("Ciel started this conversation for your work and handed it to you");
    // The lead's own start is never another session's to deliver.
    expect(
      room.starts("s-elio", [
        {
          workspaceId: "wsp_handed",
          agentId: "agt_elio",
          startedBy: "agt_ciel",
          title: "Port the verifier",
          text: "Port the verifier.",
          preparedAt: "2026-11-27T00:00:00.000Z",
        },
      ]).deliveries,
    ).toEqual([]);
  });

  it("leaves a session outside any conversation untouched", () => {
    const room = router();
    const events = said("@Ciel hello");
    expect(room.observe("s-unknown", events)).toEqual({ events, deliveries: [] });
  });
});
