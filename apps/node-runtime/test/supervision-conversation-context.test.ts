import { describe, expect, it } from "vitest";

import { validSupervisionConversationContext } from "../src/supervision-conversation-context.js";

const turn = {
  role: "assistant",
  text: "The fourth task is the backup-capacity failure.",
  speaker: {
    kind: "agent",
    participantId: "ptc_owner0001",
    agentId: "agt_owner0001",
    roleId: "developer",
  },
  source: {
    kind: "outbound",
    id: "cvo_context0001",
    roleId: "developer",
    recordHash: `sha256:${"a".repeat(64)}`,
    contentHash: `sha256:${"b".repeat(64)}`,
    observedAtMs: 1_790_000_000_000,
  },
} as const;

describe("bound conversation context", () => {
  it("accepts bounded source evidence and rejects mixed, duplicate, or unbounded turns", () => {
    expect(validSupervisionConversationContext([turn])).toBe(true);
    expect(validSupervisionConversationContext([turn, turn])).toBe(false);
    expect(
      validSupervisionConversationContext([
        { ...turn, source: { ...turn.source, kind: "inbound" } },
      ]),
    ).toBe(false);
    expect(validSupervisionConversationContext([{ ...turn, text: "x".repeat(2_049) }])).toBe(false);
    expect(
      validSupervisionConversationContext([
        { ...turn, source: { ...turn.source, recordHash: "not-a-hash" } },
      ]),
    ).toBe(false);
  });
});
