import { describe, expect, it } from "vitest";
import { sha256 } from "@lervo/repository-knowledge";

import { candidateReviewContract } from "../src/candidate-review-contract.js";

const rationale =
  "The old candidate no longer names its exact source bytes. Closing that stale candidate makes no claim about whether the changed source needs new canonical documentation.";
const invalid = /knowledge_semantic_review_invalid/u;

const binding = (path: string) => ({
  path,
  beforeHash: `sha256:${"b".repeat(64)}`,
  afterHash: `sha256:${"c".repeat(64)}`,
  responsibility: "architecture_or_specification" as const,
});
const candidate = {
  candidateId: "kcanon_1234567890abcdef12345678",
  contentHash: `sha256:${"a".repeat(64)}`,
  observedState: "stale" as const,
  sourceBindings: [binding("src/runtime.ts"), binding("src/a-config.ts")],
};

const answer = {
  candidate: "k1",
  sourcePath: "src/a-config.ts",
  decision: "reject",
  rationale,
  target: null,
  targetPath: null,
  targetQuote: null,
};

const quote = "Local execution works without a Hub.";
const target = {
  path: "docs/specs/runtime.md",
  role: "canonical_candidate" as const,
  content: `# Runtime\n\n${quote}\n`,
  contentHash: sha256(`# Runtime\n\n${quote}\n`),
};

describe("canonical candidate review contract", () => {
  it("accepts an exact stale-candidate rejection without claiming current source coverage", () => {
    const contract = candidateReviewContract({ candidates: [candidate], documents: [] });
    expect(contract.parse({ decisions: [answer] })).toEqual([
      {
        candidateId: candidate.candidateId,
        contentHash: candidate.contentHash,
        decision: "reject",
        rationale,
        targetPath: null,
        targetContentHash: null,
        targetQuote: null,
      },
    ]);
  });

  it("keeps uncertain current candidates deferred while refusing stale deferral", () => {
    expect(() =>
      candidateReviewContract({ candidates: [candidate], documents: [] }).parse({
        decisions: [{ ...answer, decision: "defer" }],
      }),
    ).toThrowError(invalid);
    expect(
      candidateReviewContract({
        candidates: [{ ...candidate, observedState: "candidate" as const }],
        documents: [],
      }).parse({ decisions: [{ ...answer, decision: "defer" }] }),
    ).toHaveLength(1);
  });

  it("shows references, not hashes, and maps a promotion back to the exact target (ADR-0604)", () => {
    const current = { ...candidate, observedState: "candidate" as const };
    const contract = candidateReviewContract({
      candidates: [current],
      documents: [target],
      priorDeferral: {
        candidateId: current.candidateId,
        contentHash: current.contentHash,
        rationale,
      },
    });
    const view = JSON.stringify(contract.view);
    expect(view).not.toMatch(/sha256:|kcanon_/u);
    expect(contract.view).toMatchObject({ priorDeferral: { candidate: "k1", rationale } });
    const item = (
      contract.schema.properties.decisions.items as { properties: Record<string, unknown> }
    ).properties;
    expect(item.candidate).toEqual({ enum: ["k1"] });
    expect(item.target).toEqual({ type: ["string", "null"], enum: ["c1", null] });
    const promote = {
      ...answer,
      decision: "promote",
      target: "c1",
      targetPath: target.path,
      targetQuote: quote,
    };
    expect(contract.parse({ decisions: [promote] })[0]).toMatchObject({
      candidateId: current.candidateId,
      targetPath: target.path,
      targetContentHash: target.contentHash,
    });
    // A target reference paired with another path, a garbled candidate, or a half-named target.
    for (const decision of [
      { ...promote, targetPath: "docs/specs/other.md" },
      { ...promote, candidate: "k2" },
      { ...promote, targetPath: null },
    ])
      expect(() => contract.parse({ decisions: [decision] })).toThrowError(invalid);
  });

  it("rejects a valid candidate reference paired with another candidate's source (ADR-0604)", () => {
    const other = {
      ...candidate,
      candidateId: "kcanon_abcdef1234567890abcdef12",
      sourceBindings: [binding("src/other.ts")],
    };
    const contract = candidateReviewContract({ candidates: [candidate, other], documents: [] });
    const item = (
      contract.schema.properties.decisions.items as { properties: Record<string, unknown> }
    ).properties;
    // ADR-0608: a path enum carries its kind, which only the provider boundary removes.
    expect(item.sourcePath).toEqual({
      enum: ["src/a-config.ts", "src/other.ts"],
      "x-lervo-ref-kind": "path",
    });
    expect(contract.view.candidates.map((item) => [item.candidate, item.sourcePath])).toEqual([
      ["k1", "src/a-config.ts"],
      ["k2", "src/other.ts"],
    ]);
    const second = { ...answer, candidate: "k2", sourcePath: "src/other.ts" };
    expect(contract.parse({ decisions: [answer, second] }).map((d) => d.candidateId)).toEqual([
      candidate.candidateId,
      other.candidateId,
    ]);
    // k2's verdict filed under k1's source names no single candidate.
    for (const decisions of [
      [answer, { ...second, sourcePath: "src/a-config.ts" }],
      [{ ...answer, sourcePath: "src/other.ts" }, second],
      [answer, { ...second, sourcePath: null }],
    ])
      expect(() => contract.parse({ decisions })).toThrowError(invalid);
    expect(() =>
      candidateReviewContract({
        candidates: [candidate, { ...other, sourceBindings: [binding("src/a-config.ts")] }],
        documents: [],
      }),
    ).toThrow(RangeError);
  });

  it("allows only a null target when there is no context to cite", () => {
    const contract = candidateReviewContract({ candidates: [candidate], documents: [] });
    const item = (
      contract.schema.properties.decisions.items as { properties: Record<string, unknown> }
    ).properties;
    expect(item.target).toEqual({ type: "null" });
    expect(item.targetPath).toEqual({ type: "null" });
  });
});
