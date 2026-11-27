import { expect, it, vi } from "vitest";

import type {
  KnowledgePublicationForge,
  KnowledgePublicationMergeGate,
} from "../src/knowledge-publication-forge.js";
import { mergeKnowledgePublication } from "../src/knowledge-publication-merge.js";

function forge(gate: KnowledgePublicationMergeGate) {
  const merge = vi.fn(async () => undefined);
  const value = {
    gate: vi.fn(async () => gate),
    merge,
    viewPullRequest: vi.fn(async () => ({ state: "merged", mergeCommit: "a".repeat(40) })),
  } as unknown as KnowledgePublicationForge;
  return { value, merge };
}

const input = { number: 7, headSha: "b".repeat(40), method: "merge" as const };

it("waits at a release train's gate without asking the forge to merge", async () => {
  const { value, merge } = forge("release_train");
  expect(await mergeKnowledgePublication({ ...input, forge: value })).toEqual({
    status: "waiting",
    kind: "gate",
    reason: "release_train",
  });
  expect(merge).not.toHaveBeenCalled();
});

it("merges once the gate is ready", async () => {
  const { value, merge } = forge("ready");
  expect(await mergeKnowledgePublication({ ...input, forge: value })).toEqual({
    status: "merged",
    mergeCommit: "a".repeat(40),
  });
  expect(merge).toHaveBeenCalledTimes(1);
});
