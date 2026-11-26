import { expect, it, vi } from "vitest";

import type { KnowledgePublicationForge } from "../src/knowledge-publication-forge.js";
import { mergeKnowledgePublication } from "../src/knowledge-publication-merge.js";

function forge() {
  const merge = vi.fn(async () => undefined);
  const value = {
    gate: vi.fn(async () => "ready"),
    merge,
    viewPullRequest: vi.fn(async () => ({ state: "merged", mergeCommit: "a".repeat(40) })),
  } as unknown as KnowledgePublicationForge;
  return { value, merge };
}

const input = { number: 7, headSha: "b".repeat(40), method: "merge" as const };

it("waits at a host hold without asking the forge to merge", async () => {
  const { value, merge } = forge();
  expect(
    await mergeKnowledgePublication({ ...input, forge: value, hold: async () => "release_train" }),
  ).toEqual({ status: "waiting", kind: "gate", reason: "release_train" });
  expect(merge).not.toHaveBeenCalled();
});

it("merges when no hold stands, and when the hold cannot be read", async () => {
  for (const hold of [
    async () => null,
    async () => {
      throw new Error("control file unreadable");
    },
  ]) {
    const { value, merge } = forge();
    expect(await mergeKnowledgePublication({ ...input, forge: value, hold })).toEqual({
      status: "merged",
      mergeCommit: "a".repeat(40),
    });
    expect(merge).toHaveBeenCalledTimes(1);
  }
});
