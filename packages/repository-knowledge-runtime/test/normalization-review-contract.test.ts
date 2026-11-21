import type { DocumentNormalizationCandidate } from "@lervo/repository-knowledge";
import {
  assertProviderOutputSchemaForSource,
  providerOutputSchema,
  providerWireSchema,
} from "@lervo/schemas";
import { expect, it } from "vitest";

import { providerNativeResponseSchema } from "@lervo/repository-knowledge-compiler";
import { normalizationReviewContract } from "../src/normalization-review.js";

const hash = (seed: string) => `sha256:${seed.repeat(64).slice(0, 64)}`;

/** Three documents shaped like the flemo candidate whose review failed (2026-11-21). */
function candidate(): DocumentNormalizationCandidate {
  const item = (index: number, units: number, outputs: number) => {
    const unitIds = Array.from(
      { length: units },
      (_, unit) => `uv_${index}${unit}${"0".repeat(22)}`,
    );
    return {
      operationId: `knormop_${index}${"a".repeat(23)}`,
      approvalHash: hash(`${index}b`),
      sourcePath: `docs/source-${index}.md`,
      sourceContentHash: hash(`${index}c`),
      sourceByteCount: 120,
      profile: "document",
      sourceUnitVersionIds: unitIds,
      resourceBindings: [],
      outputs: Array.from({ length: outputs }, (_, output) => ({
        path: `docs/normalized-${index}-${output}.md`,
        content: `# Output ${output}\n`,
        contentHash: hash(`${index}${output}d`),
        byteCount: 12,
        // The first output covers every unit; later ones cover one unit each.
        coveredUnitVersionIds: output === 0 ? unitIds : [unitIds[output % units]!],
      })),
    };
  };
  return {
    schemaVersion: 1,
    candidateId: "knorm_2e1ecb82473f8042bd1aff08",
    sourceSnapshotId: "snap",
    outputLanguage: "en",
    formatVersion: "lervo.document.v1",
    compiler: {} as DocumentNormalizationCandidate["compiler"],
    workset: {} as DocumentNormalizationCandidate["workset"],
    shardIds: [],
    items: [item(1, 2, 3), item(2, 3, 2), item(3, 1, 1)],
    coverage: { eligibleDocuments: 3, normalizedDocuments: 3, sourceUnits: 6, complete: true },
    assurance: "unreviewed",
  } as unknown as DocumentNormalizationCandidate;
}

const checks = Object.fromEntries(
  [
    "meaning",
    "requirements",
    "examples",
    "links",
    "lifecycle",
    "protectedRegions",
    "skillIdentity",
    "resources",
  ].map((check) => [check, true]),
);

type View = {
  documents: {
    document: string;
    sourcePath: string;
    units: string[];
    outputs: { output: string; path: string; coversUnits: string[] }[];
  }[];
};

/** What a reviewer that follows the contract returns: every reference copied from the view. */
function answer(view: View) {
  return {
    decisions: view.documents.map((document) => ({
      document: document.document,
      sourcePath: document.sourcePath,
      decision: "approve",
      rationale: "Every requirement, example, link and lifecycle field is preserved exactly.",
      checks,
      unitReviews: document.units.map((unit) => ({
        unit,
        outputs: document.outputs
          .filter((output) => output.coversUnits.includes(unit))
          .map(({ output, path }) => ({ output, path })),
        rationale: "This unit is preserved in the cited outputs.",
      })),
    })),
  };
}

it("gives the reviewer nothing to copy that a schema cannot check (ADR-0604)", () => {
  const value = candidate();
  const contract = normalizationReviewContract(value);
  // No hash or opaque identifier reaches the reviewer; only short references it cites back.
  const view = JSON.stringify(contract.view);
  expect(view).not.toMatch(/sha256:|knormop_|uv_|knorm_/u);
  // The schema allows exactly the candidate's references, each document only its own, and keeps
  // them for the provider, which receives it without reference-kind marks (ADR-0608).
  const native = providerNativeResponseSchema(providerWireSchema(contract.schema)) as unknown as {
    properties: { decisions: { items: { anyOf: { properties: Record<string, unknown> }[] } } };
  };
  const documents = native.properties.decisions.items.anyOf.map((item) => item.properties);
  expect(documents.map((item) => [item.document, item.sourcePath])).toEqual([
    [{ enum: ["d1"] }, { enum: ["docs/source-1.md"] }],
    [{ enum: ["d2"] }, { enum: ["docs/source-2.md"] }],
    [{ enum: ["d3"] }, { enum: ["docs/source-3.md"] }],
  ]);
  const second = (
    documents[1]!.unitReviews as {
      items: { properties: { unit: unknown; outputs: { items: { properties: unknown } } } };
    }
  ).items.properties;
  expect(second.unit).toEqual({ enum: ["d2.u1", "d2.u2", "d2.u3"] });
  expect(second.outputs.items.properties).toEqual({
    output: { enum: ["d2.o1", "d2.o2"] },
    path: { enum: ["docs/normalized-2-0.md", "docs/normalized-2-1.md"] },
  });
});

it("maps a reviewer's references back to the exact identifiers the apply stage binds", () => {
  const value = candidate();
  const contract = normalizationReviewContract(value);
  const decisions = contract.parse(answer(contract.view as View));
  expect(decisions.map((decision) => decision.operationId)).toEqual(
    value.items.map((item) => item.operationId),
  );
  const first = value.items[0]!;
  expect(decisions[0]).toMatchObject({
    sourceContentHash: first.sourceContentHash,
    decision: "approve",
    unitReviews: [
      {
        unitVersionId: first.sourceUnitVersionIds[0],
        outputHashes: [first.outputs[0]!.contentHash, first.outputs[2]!.contentHash],
      },
      {
        unitVersionId: first.sourceUnitVersionIds[1],
        outputHashes: [first.outputs[0]!.contentHash, first.outputs[1]!.contentHash],
      },
    ],
  });
});

it("rejects a reference to another document's output, an uncovered unit, or a missing document", () => {
  const contract = normalizationReviewContract(candidate());
  const good = () => answer(contract.view as View);
  const foreign = good();
  foreign.decisions[0]!.unitReviews[0]!.outputs = [
    { output: "d2.o1", path: "docs/normalized-2-0.md" },
  ];
  const uncovered = good();
  // d1.o2 covers only d1.u2.
  uncovered.decisions[0]!.unitReviews[0]!.outputs = [
    { output: "d1.o2", path: "docs/normalized-1-1.md" },
  ];
  // A valid output reference of this document paired with another output's path: d1.o1 and d1.o3
  // both cover d1.u1, so only the path shows the reviewer meant another output.
  const wrongOutput = good();
  wrongOutput.decisions[0]!.unitReviews[0]!.outputs = [
    { output: "d1.o1", path: "docs/normalized-1-2.md" },
  ];
  const bareOutput = good();
  (bareOutput.decisions[0]!.unitReviews[0]!.outputs as unknown[]) = ["d1.o1"];
  const garbled = good();
  garbled.decisions[1]!.unitReviews[0]!.unit = "d2.u9";
  const missing = good();
  missing.decisions.pop();
  const twice = good();
  twice.decisions[2]!.document = "d1";
  twice.decisions[2]!.sourcePath = "docs/source-1.md";
  // A valid reference paired with another document's path names no single document.
  const mispaired = good();
  mispaired.decisions[0]!.sourcePath = "docs/source-2.md";
  for (const value of [
    foreign,
    uncovered,
    wrongOutput,
    bareOutput,
    garbled,
    missing,
    twice,
    mispaired,
  ])
    expect(() => contract.parse(value)).toThrow(
      expect.objectContaining({ code: "knowledge_semantic_review_invalid" }),
    );
  // A rejection needs no unit coverage.
  const rejected = good();
  rejected.decisions[2] = { ...rejected.decisions[2]!, decision: "reject", unitReviews: [] };
  expect(contract.parse(rejected)[2]).toMatchObject({ decision: "reject", unitReviews: [] });
});

it("reviews an owner-rule document whose path holds hex, and refuses that path anywhere else (ADR-0608)", () => {
  const value = candidate();
  // Owner-rule documents are named `rule_<24 hex>.md`.
  (value.items[0] as { sourcePath: string }).sourcePath =
    "docs/instructions/generated/rule_5d2a8f0c1e9b7a6d4c3b2a10.md";
  const contract = normalizationReviewContract(value);
  expect(() => assertProviderOutputSchemaForSource(contract.schema, contract.view)).not.toThrow();
  expect(() =>
    assertProviderOutputSchemaForSource(
      providerOutputSchema({
        type: "object",
        properties: {
          pick: { enum: ["docs/instructions/generated/rule_5d2a8f0c1e9b7a6d4c3b2a10.md"] },
        },
      }),
      contract.view,
    ),
  ).toThrow(/offers an identifier or hash from the source data/u);
});
