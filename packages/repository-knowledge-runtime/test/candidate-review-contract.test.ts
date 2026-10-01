import { describe, expect, it } from "vitest";

import { parseCandidateReview } from "../src/candidate-review-contract.js";

const rationale =
  "The old candidate no longer names its exact source bytes. Closing that stale candidate makes no claim about whether the changed source needs new canonical documentation.";

const candidate = {
  candidateId: "kcanon_1234567890abcdef12345678",
  contentHash: `sha256:${"a".repeat(64)}`,
  observedState: "stale",
} as const;

const decision = {
  candidateId: candidate.candidateId,
  contentHash: candidate.contentHash,
  decision: "reject",
  rationale,
  targetPath: null,
  targetContentHash: null,
  targetQuote: null,
};

describe("canonical candidate review contract", () => {
  it("accepts an exact stale-candidate rejection without claiming current source coverage", () => {
    expect(parseCandidateReview({ decisions: [decision] }, [candidate], [])).toEqual([decision]);
  });

  it("keeps uncertain current candidates deferred while refusing stale deferral", () => {
    expect(() =>
      parseCandidateReview({ decisions: [{ ...decision, decision: "defer" }] }, [candidate], []),
    ).toThrowError(/knowledge_semantic_review_invalid/u);
    expect(
      parseCandidateReview(
        { decisions: [{ ...decision, decision: "defer" }] },
        [{ ...candidate, observedState: "candidate" as const }],
        [],
      ),
    ).toHaveLength(1);
  });
});
