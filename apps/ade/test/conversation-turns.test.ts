import type { ConversationItem } from "@lervo/session-host-contract";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { describe, expect, it } from "vitest";

import { queuedReplies, turnEnds } from "../src/features/conversation/model/turns";
import { ConversationItemView } from "../src/features/conversation/view/renderers";
import { messagesFor } from "../src/i18n/catalog";

const user = (id: string, at: number): ConversationItem => ({
  kind: "user_message",
  itemId: id,
  createdAtMs: at,
  state: "complete",
  text: id,
});
const agent = (id: string, at: number): ConversationItem => ({
  kind: "agent_message",
  itemId: id,
  createdAtMs: at,
  state: "complete",
  text: id,
});
const notice = (id: string, at: number, code: string): ConversationItem => ({
  kind: "lervo_notice",
  itemId: id,
  createdAtMs: at,
  state: "complete",
  code,
  parameters: { trigger: "auto" },
});

describe("turns in the conversation", () => {
  it("ends each turn at the item before the next message, and the last once work stops", () => {
    const items = [
      user("u1", 1_000),
      agent("a1", 4_000),
      agent("a2", 9_000),
      user("u2", 20_000),
      agent("a3", 23_000),
    ];
    expect([...turnEnds(items, true).entries()]).toEqual([
      [2, { turn: "u1", elapsedMs: 8_000, window: { startedAtMs: 1_000, endedAtMs: 20_000 } }],
    ]);
    expect(turnEnds(items, false).get(4)).toEqual({
      turn: "u2",
      elapsedMs: 3_000,
      window: { startedAtMs: 20_000 },
    });
    // A message the agent has not answered ends no turn yet.
    expect(turnEnds([user("u1", 1)], false).size).toBe(0);
  });

  it("keeps a reply sent while the agent worked queued until the agent's next item", () => {
    const sent = [user("u1", 1_000), agent("a1", 2_000), user("u2", 3_000)];
    expect([...queuedReplies(sent, 2_500)]).toEqual(["u2"]);
    expect([...queuedReplies([...sent, notice("n1", 3_100, "turn_stopped")], 2_500)]).toEqual([
      "u2",
    ]);
    expect(queuedReplies([...sent, agent("a2", 4_000)], 2_500).size).toBe(0);
    expect(queuedReplies(sent, null).size).toBe(0);
  });

  it("shows a compaction as a divider, not a notice line", () => {
    const html = renderToStaticMarkup(
      createElement(
        IntlProvider,
        { locale: "en", messages: messagesFor("en") },
        createElement(ConversationItemView, { item: notice("n1", 1, "context_compacted") }),
      ),
    );
    expect(html).toContain('role="separator"');
    expect(html).toContain("Context compacted");
    expect(html).not.toContain("Lervo");
  });
});
