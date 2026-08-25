import {
  contentId,
  createSearchAttempt,
  LexicalSearchIndex,
  type SearchAttempt,
  type SearchRolloutReviewTarget,
  type SearchSourceInput,
} from "../src/index.js";

const sources: SearchSourceInput[] = [
  {
    kind: "document",
    sourceId: "doc_rollout_01",
    contentHash: `sha256:${"a".repeat(64)}`,
    labels: ["rollout"],
    text: "Search result to review.",
  },
];

export const rolloutTarget: SearchRolloutReviewTarget = {
  selectionTransitionId: `seact_${"b".repeat(24)}`,
  candidateId: "fixture-v1",
  engine: { id: "fixture_candidate", version: 1 },
  adapterBuildId: contentId("sebuild", { adapter: "fixture_candidate", revision: 1 }),
  candidateReviewId: `scrv_${"c".repeat(24)}`,
};

export function rolloutAttempt(nonce: string, observedAt: string): SearchAttempt {
  return createSearchAttempt({
    projectId: "prj_search_01",
    observedAt: new Date(observedAt),
    nonce,
    response: {
      ...new LexicalSearchIndex(sources).search("review result"),
      engine: rolloutTarget.engine,
    },
    selectionTransitionId: rolloutTarget.selectionTransitionId,
  });
}
