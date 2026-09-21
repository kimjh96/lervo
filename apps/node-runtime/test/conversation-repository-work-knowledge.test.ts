import { describe, expect, it, vi } from "vitest";

import { resolveConversationRepositoryWorkKnowledgeDisposition } from "../src/conversation-repository-work-knowledge.js";

describe("conversation repository-work knowledge completion", () => {
  it.each([
    [true, "current"],
    [false, "baseline_valid"],
  ] as const)(
    "accepts read-only work from its observed knowledge baseline (%s)",
    async (baselineKnowledgeCurrent, expected) => {
      const assertCurrent = vi.fn(async () => {
        throw new Error("stale projection");
      });
      const lintIsValid = vi.fn(async () => false);

      await expect(
        resolveConversationRepositoryWorkKnowledgeDisposition({
          changedPathCount: 0,
          baselineKnowledgeCurrent,
          assertCurrent,
          lintIsValid,
        }),
      ).resolves.toBe(expected);
      expect(assertCurrent).not.toHaveBeenCalled();
      expect(lintIsValid).not.toHaveBeenCalled();
    },
  );

  it("still rejects changed work that leaves new knowledge debt", async () => {
    const failure = new Error("stale projection");

    await expect(
      resolveConversationRepositoryWorkKnowledgeDisposition({
        changedPathCount: 1,
        baselineKnowledgeCurrent: true,
        assertCurrent: async () => {
          throw failure;
        },
        lintIsValid: async () => false,
      }),
    ).rejects.toBe(failure);
  });

  it("retains valid pre-existing knowledge debt for changed work", async () => {
    await expect(
      resolveConversationRepositoryWorkKnowledgeDisposition({
        changedPathCount: 1,
        baselineKnowledgeCurrent: false,
        assertCurrent: async () => {
          throw new Error("stale projection");
        },
        lintIsValid: async () => true,
      }),
    ).resolves.toBe("baseline_valid");
  });
});
