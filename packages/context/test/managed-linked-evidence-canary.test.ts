import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  ManagedLinkedEvidenceCanaryError,
  managedLinkedEvidenceCanaryPolicy,
  managedLinkedEvidenceDefaultPolicy,
  managedLinkedEvidenceSelectionSchema,
  parseManagedLinkedEvidenceSelection,
  projectManagedLinkedEvidenceCanary,
  type LinkedEvidenceShadowSource,
} from "../src/index.js";
import { ContextSelectionAccumulator } from "../src/accumulator.js";
import { applyDefaultManagedLinkedEvidenceSelections } from "../src/managed-linked-evidence-default-selection.js";
import { applyManagedLinkedEvidenceSelections } from "../src/managed-linked-evidence-selection.js";

function source(documentId: string, path: string, text: string): LinkedEvidenceShadowSource {
  return {
    documentId,
    path,
    text,
    contentHash: `sha256:${createHash("sha256").update(text).digest("hex")}`,
  };
}

describe("managed linked-evidence canary policy", () => {
  it("projects one-hop candidates and validates an exact structured selection", () => {
    const linked = source("doc_linked_0001", "docs/linked.md", "# Linked\n\nExact rule.\n");
    const recommendation = source(
      "doc_recommendation_0001",
      "docs/current.md",
      "# Current\n\nSee [the rule](linked.md).\n",
    );
    const projection = projectManagedLinkedEvidenceCanary({
      corpus: [recommendation, linked],
      recommendations: [recommendation],
      existingPaths: [recommendation.path],
    });

    expect(managedLinkedEvidenceCanaryPolicy.enabledByDefault).toBe(false);
    expect(managedLinkedEvidenceDefaultPolicy).toMatchObject({
      enabledByDefault: true,
      maximumSelectionCalls: 0,
    });
    expect(projection.candidates).toHaveLength(1);
    expect(projection.providerVisibleSourceBytes).toBe(Buffer.byteLength(linked.text));
    expect(managedLinkedEvidenceSelectionSchema(projection.candidates)).toMatchObject({
      properties: { evidenceTokens: { maxItems: 8 } },
    });
    expect(
      parseManagedLinkedEvidenceSelection({
        content: JSON.stringify({ evidenceTokens: [projection.candidates[0]!.token] }),
        candidates: projection.candidates,
        selectionAttemptId: `lsel_${"a".repeat(24)}`,
      }),
    ).toEqual([
      {
        schemaVersion: 1,
        selectionAttemptId: `lsel_${"a".repeat(24)}`,
        documentId: linked.documentId,
        path: linked.path,
        contentHash: linked.contentHash,
        rank: 1,
      },
    ]);
  });

  it("rejects duplicate, unknown, and stale selections before context loading", () => {
    const linked = source("doc_linked_0001", "docs/linked.md", "# Linked\n");
    const candidate = {
      ...linked,
      byteCount: Buffer.byteLength(linked.text),
      token: `lervo-e4:${linked.documentId}:${linked.contentHash}`,
      linkedFromPath: "docs/current.md",
    };
    for (const evidenceTokens of [
      [candidate.token, candidate.token],
      [`lervo-e4:doc_unknown_0001:sha256:${"0".repeat(64)}`],
    ]) {
      expect(() =>
        parseManagedLinkedEvidenceSelection({
          content: JSON.stringify({ evidenceTokens }),
          candidates: [candidate],
          selectionAttemptId: `lsel_${"b".repeat(24)}`,
        }),
      ).toThrow(expect.objectContaining({ code: "canary_selection_invalid" }));
    }
    expect(() =>
      projectManagedLinkedEvidenceCanary({
        corpus: [linked],
        recommendations: [{ ...linked, text: `${linked.text}changed` }],
        existingPaths: [],
      }),
    ).toThrow(ManagedLinkedEvidenceCanaryError);
  });

  it("adds selected sources to the ordinary exact-hash E1 and E2 plan boundary", () => {
    const contentHash = `sha256:${"a".repeat(64)}`;
    const candidate = {
      documentId: "doc_linked_0001",
      path: "docs/linked.md",
      connectedPaths: [],
      source: "registry" as const,
      documentRole: "task_evidence" as const,
      referenceEligible: true,
    };
    const accumulator = new ContextSelectionAccumulator();
    applyManagedLinkedEvidenceSelections({
      selections: [
        {
          schemaVersion: 1,
          selectionAttemptId: `lsel_${"b".repeat(24)}`,
          documentId: candidate.documentId,
          path: candidate.path,
          contentHash,
          rank: 1,
        },
      ],
      candidates: new Map([[candidate.documentId, candidate]]),
      accumulator,
    });

    expect(accumulator.documents()).toEqual([
      expect.objectContaining({
        documentId: candidate.documentId,
        documentRole: "task_evidence",
        referenceEligible: false,
        expectedContentHash: contentHash,
        reasons: [
          {
            reasonCode: "explicit_link",
            ruleId: `linked_evidence_canary:lsel_${"b".repeat(24)}`,
          },
        ],
      }),
    ]);
  });

  it("keeps direct claim eligibility when an explicitly linked selection duplicates it", () => {
    const contentHash = `sha256:${"c".repeat(64)}`;
    const candidate = {
      documentId: "doc_linked_0002",
      path: "docs/direct-and-linked.md",
      connectedPaths: ["src/**"],
      source: "registry" as const,
      documentRole: "task_evidence" as const,
      referenceEligible: true,
    };
    const accumulator = new ContextSelectionAccumulator();
    accumulator.select({
      candidate,
      reason: { reasonCode: "path_rule", ruleId: "path:direct" },
    });
    applyManagedLinkedEvidenceSelections({
      selections: [
        {
          schemaVersion: 1,
          selectionAttemptId: `lsel_${"c".repeat(24)}`,
          documentId: candidate.documentId,
          path: candidate.path,
          contentHash,
          rank: 1,
        },
      ],
      candidates: new Map([[candidate.documentId, candidate]]),
      accumulator,
    });

    expect(accumulator.documents()[0]).toMatchObject({
      documentId: candidate.documentId,
      referenceEligible: true,
      reasons: expect.arrayContaining([
        expect.objectContaining({ reasonCode: "path_rule" }),
        expect.objectContaining({ reasonCode: "explicit_link" }),
      ]),
    });
  });

  it("identifies default linked selections separately from exact canary evidence", () => {
    const contentHash = `sha256:${"d".repeat(64)}`;
    const candidate = {
      documentId: "doc_linked_default_0001",
      path: "docs/default-linked.md",
      connectedPaths: [],
      source: "registry" as const,
      documentRole: "task_evidence" as const,
      referenceEligible: true,
    };
    const accumulator = new ContextSelectionAccumulator();
    applyDefaultManagedLinkedEvidenceSelections({
      selections: [
        {
          schemaVersion: 1,
          selectionAttemptId: `lsel_${"d".repeat(24)}`,
          documentId: candidate.documentId,
          path: candidate.path,
          contentHash,
          rank: 1,
        },
      ],
      candidates: new Map([[candidate.documentId, candidate]]),
      accumulator,
    });

    expect(accumulator.documents()[0]).toMatchObject({
      documentId: candidate.documentId,
      referenceEligible: false,
      reasons: [
        {
          reasonCode: "explicit_link",
          ruleId: `${managedLinkedEvidenceDefaultPolicy.selectionRuleId}:lsel_${"d".repeat(24)}`,
        },
      ],
    });
  });
});
