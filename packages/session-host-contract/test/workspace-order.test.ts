import { describe, expect, it } from "vitest";

import { conversationOrder } from "@lervo/session-host-contract";

const conversation = (workspaceId: string, activeAt?: string, pinnedAt?: string) => ({
  workspaceId,
  ...(activeAt === undefined ? {} : { activeAt }),
  ...(pinnedAt === undefined ? {} : { pinnedAt }),
});

const ids = (conversations: readonly { workspaceId: string }[]) =>
  conversations.map((item) => item.workspaceId);

describe("the conversation list's order", () => {
  it("puts the latest pinned first, then the others by their latest activity", () => {
    const listed = [
      conversation("oldest", "2026-11-20T00:00:00.000Z"),
      conversation("pinned-first", "2026-11-27T00:00:00.000Z", "2026-11-28T09:00:00.000Z"),
      conversation("newest", "2026-11-28T00:00:00.000Z"),
      conversation("pinned-later", "2026-11-21T00:00:00.000Z", "2026-11-28T10:00:00.000Z"),
      conversation("middle", "2026-11-24T00:00:00.000Z"),
    ];
    expect(ids(conversationOrder(listed))).toEqual([
      "pinned-later",
      "pinned-first",
      "newest",
      "middle",
      "oldest",
    ]);
  });

  it("returns an unpinned conversation to its place by activity", () => {
    const listed = [
      conversation("was-pinned", "2026-11-24T00:00:00.000Z"),
      conversation("newest", "2026-11-28T00:00:00.000Z"),
      conversation("oldest", "2026-11-20T00:00:00.000Z"),
    ];
    expect(ids(conversationOrder(listed))).toEqual(["newest", "was-pinned", "oldest"]);
  });

  it("keeps an older core's order, which has no activity times", () => {
    const listed = [conversation("first"), conversation("second"), conversation("third")];
    expect(conversationOrder(listed)).toEqual(listed);
  });
});
