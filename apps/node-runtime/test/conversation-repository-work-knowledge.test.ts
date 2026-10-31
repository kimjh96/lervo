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
      const lintReport = vi.fn(async () => ({ valid: true, coverage: "complete" as const }));

      await expect(
        resolveConversationRepositoryWorkKnowledgeDisposition({
          changedPathCount: 0,
          baselineKnowledgeCurrent,
          assertCurrent,
          lintReport,
        }),
      ).resolves.toBe(expected);
      expect(assertCurrent).toHaveBeenCalledTimes(baselineKnowledgeCurrent ? 0 : 1);
      expect(lintReport).toHaveBeenCalledTimes(baselineKnowledgeCurrent ? 0 : 1);
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
        lintReport: async () => ({ valid: false, coverage: "complete" }),
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
        lintReport: async () => ({ valid: true, coverage: "complete" }),
      }),
    ).resolves.toBe("baseline_valid");
  });
});

it.each([0, 1])(
  "rejects a partial lint baseline with %i changed paths",
  async (changedPathCount) => {
    const failure = new Error("current knowledge unavailable");
    await expect(
      resolveConversationRepositoryWorkKnowledgeDisposition({
        changedPathCount,
        baselineKnowledgeCurrent: false,
        assertCurrent: async () => {
          throw failure;
        },
        lintReport: async () => ({ valid: true, coverage: "partial" }),
      }),
    ).rejects.toBe(failure);
  },
);
