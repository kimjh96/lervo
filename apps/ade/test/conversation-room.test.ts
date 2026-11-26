import type { ConversationItem } from "@lervo/session-host-contract";
import { describe, expect, it } from "vitest";

import { roomView } from "../src/features/conversation/model/room";

function item(itemId: string, at: number, content: Partial<ConversationItem>): ConversationItem {
  return { itemId, createdAtMs: at, state: "complete", ...content } as ConversationItem;
}

const owner = (id: string, at: number, text: string) =>
  item(id, at, { kind: "user_message", text });
const said = (id: string, at: number, text: string) =>
  item(id, at, { kind: "agent_message", text });

describe("a conversation of several agents' sessions", () => {
  it("interleaves the sessions by time, names each speaker change, and drops repeats", () => {
    const lead = {
      items: [
        owner("i1", 1000, "Implement retries."),
        said("i2", 2000, "@Arin is Retry-After in seconds?"),
        item("i3", 9000, { kind: "peer_message", from: "Arin", text: "Seconds." }),
        said("i4", 9500, "Implemented."),
      ],
      hasEarlier: false,
      hasLater: false,
    };
    const arin = {
      agentId: "agt_arin",
      sessionId: "ses_arin",
      window: {
        items: [
          item("i1", 3000, { kind: "peer_message", from: "Ciel", text: "@Arin is it?" }),
          said("i2", 4000, "Seconds."),
        ],
        hasEarlier: false,
        hasLater: false,
      },
    };
    const view = roomView(lead, "agt_ciel", [arin]);
    expect(view.window.items.map((entry) => entry.itemId)).toEqual([
      "i1",
      "i2",
      "ses_arin:i2",
      "i4",
    ]);
    expect([...view.changes]).toEqual(["i2", "ses_arin:i2", "i4"]);
    expect(view.speakers.get("ses_arin:i2")).toBe("agt_arin");
  });

  it("shows the owner's turn to several agents once, and a one-agent conversation unchanged", () => {
    const lead = {
      items: [owner("i1", 1000, "@Ciel @Arin look")],
      hasEarlier: false,
      hasLater: false,
    };
    const arin = {
      agentId: "agt_arin",
      sessionId: "ses_arin",
      window: {
        items: [owner("i1", 1200, "@Ciel @Arin look")],
        hasEarlier: false,
        hasLater: false,
      },
    };
    expect(roomView(lead, "agt_ciel", [arin]).window.items).toHaveLength(1);
    const alone = roomView(lead, "agt_ciel", []);
    expect(alone.window).toBe(lead);
    expect(alone.changes.size).toBe(0);
  });

  it("keeps a member's older items out until the lead's window reaches them", () => {
    const lead = { items: [said("i9", 5000, "later")], hasEarlier: true, hasLater: false };
    const arin = {
      agentId: "agt_arin",
      sessionId: "ses_arin",
      window: {
        items: [said("i1", 1000, "early"), said("i2", 6000, "late")],
        hasEarlier: false,
        hasLater: false,
      },
    };
    expect(roomView(lead, "agt_ciel", [arin]).window.items.map((entry) => entry.itemId)).toEqual([
      "i9",
      "ses_arin:i2",
    ]);
  });
});
