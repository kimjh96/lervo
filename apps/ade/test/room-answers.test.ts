import type { ConversationItem } from "@lervo/session-host-contract";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { describe, expect, it } from "vitest";

import { roomView } from "../src/features/conversation/model/room";
import { answerItems, withAnswers } from "../src/features/conversation/model/room-answers";
import { ConversationItemView } from "../src/features/conversation/view/renderers";
import { messagesFor } from "../src/i18n/catalog";

const answers = [
  {
    mentionId: `mnt_${"1".repeat(24)}`,
    workspaceId: `wsp_${"b".repeat(24)}`,
    fromAgentId: "agt_iris",
    deliveredAt: "2026-11-27T03:05:00.000Z",
  },
];
const names = (agentId: string) => ({ agt_iris: "Iris" })[agentId] ?? null;

describe("what the lead answered elsewhere", () => {
  it("shows each answer as a quiet line at its time in the conversation's timeline", () => {
    const lines = answerItems(answers, "Ciel", names);
    expect(lines).toEqual([
      expect.objectContaining({
        kind: "lervo_notice",
        code: "room_answered_elsewhere",
        createdAtMs: Date.parse("2026-11-27T03:05:00.000Z"),
        parameters: { agent: "Ciel", from: "Iris", workspace: answers[0]!.workspaceId },
      }),
    ]);
    const said = (itemId: string, at: string): ConversationItem => ({
      kind: "agent_message",
      itemId,
      createdAtMs: Date.parse(at),
      state: "complete",
      text: itemId,
    });
    const lead = {
      items: [said("before", "2026-11-27T03:00:00Z"), said("after", "2026-11-27T03:10:00Z")],
      hasEarlier: false,
      hasLater: false,
    };
    expect(withAnswers(lead, lines).items.map((item) => item.itemId)).toEqual([
      "before",
      `answer-${answers[0]!.mentionId}`,
      "after",
    ]);
    // A peer message in a conversation without joined agents stays, as the lead's view keeps it.
    const peer: ConversationItem = {
      kind: "peer_message",
      itemId: "peer",
      createdAtMs: Date.parse("2026-11-27T02:59:00Z"),
      state: "complete",
      from: "Iris",
      text: "Please look at the retry budget.",
    };
    const started = { ...lead, items: [peer, ...lead.items] };
    expect(
      withAnswers(roomView(started, "agt_ciel", []).window, lines).items.map((item) => item.itemId),
    ).toEqual(["peer", "before", `answer-${answers[0]!.mentionId}`, "after"]);
    // Before the conversation's own items load, no line joins: a line alone would place the list,
    // and the history would then settle in view.
    const empty = { items: [], hasEarlier: false, hasLater: false };
    expect(withAnswers(empty, lines)).toBe(empty);
    // An answer older than a page that has earlier pages waits for them.
    expect(
      withAnswers(
        { ...lead, hasEarlier: true },
        answerItems([{ ...answers[0]!, deliveredAt: "2026-11-27T02:00:00.000Z" }], "Ciel", names),
      ).items,
    ).toHaveLength(2);
  });

  it("keeps one line per conversation and agent, at the newest answer there", () => {
    const at = (minute: number) => `2026-11-27T03:${String(minute).padStart(2, "0")}:00.000Z`;
    const repeated = [1, 2, 3].map((minute) => ({ ...answers[0]!, deliveredAt: at(minute) }));
    const other = { ...answers[0]!, fromAgentId: "agt_ciel", deliveredAt: at(4) };
    const lines = answerItems([...repeated, other], "Bora", names);
    expect(lines.map((line) => line.createdAtMs)).toEqual([Date.parse(at(3)), Date.parse(at(4))]);
  });

  it("names the other conversation, or says another when it is not listed", () => {
    const [line] = answerItems(answers, "Ciel", names);
    const html = renderToStaticMarkup(
      createElement(
        IntlProvider,
        { locale: "en", messages: messagesFor("en") },
        createElement(ConversationItemView, { item: line! }),
      ),
    );
    expect(html).toContain("Ciel answered Iris in another conversation");
  });
});
