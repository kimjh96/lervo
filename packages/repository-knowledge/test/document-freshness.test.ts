import { describe, expect, it } from "vitest";

import {
  planDocumentFreshnessArchive,
  rewriteDocumentLinks,
} from "../src/document-freshness-archive.js";
import {
  classifyDocumentFreshnessHunk,
  documentFreshnessCrossCheckRequired,
  documentFreshnessRequiredAgreements,
  documentFreshnessDocumentOwnership,
  documentFreshnessInstructionLine,
  documentFreshnessRangeOwnership,
} from "../src/document-freshness-classification.js";
import {
  defaultDocumentFreshnessPolicy,
  type DocumentFreshnessFindingV1,
} from "../src/document-freshness-contract.js";
import {
  documentFreshnessFinding,
  documentFreshnessFindingsDigest,
} from "../src/document-freshness-finding.js";
import {
  applyDocumentFreshnessHunks,
  documentFreshnessChangedBytes,
  documentFreshnessOutsideBytesUnchanged,
  locateDocumentFreshnessHunks,
} from "../src/document-freshness-hunks.js";
import { lervoManagedRegions } from "../src/document-freshness-managed-regions.js";
import { documentFreshnessPublicationGroup } from "../src/document-freshness-publication-group.js";
import { documentFreshnessPolicySectionValid } from "../src/document-freshness-policy.js";
import {
  admitDocumentFreshnessFindings,
  documentFreshnessPriorityClass,
  orderDocumentFreshnessFindings,
} from "../src/document-freshness-priority.js";
import { parseDocumentFreshnessProposal } from "../src/document-freshness-response.js";
import {
  documentFreshnessCompactLine,
  documentFreshnessTurnReportSegment,
} from "../src/document-freshness-surfaces.js";
import {
  validateRepositoryKnowledgePolicy,
  defaultRepositoryKnowledgePolicy,
} from "../src/policy.js";

const bytes = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));

function finding(overrides: Partial<Parameters<typeof documentFreshnessFinding>[0]> = {}) {
  return documentFreshnessFinding({
    documentPath: "AGENTS.md",
    documentHash: `sha256:${"a".repeat(64)}`,
    currentRevision: "b".repeat(40),
    staleness: { reasons: ["connected_path_changed"], verifiedRevision: "c".repeat(40) },
    sources: ["document_stale"],
    connectedPathChanges: [
      {
        path: "v2/engine.py",
        beforeHash: `sha256:${"d".repeat(64)}`,
        afterHash: null,
        disposition: "deleted",
        renamedTo: null,
      },
    ],
    references: [
      {
        line: 3,
        target: "v2/engine.py",
        kind: "path_mention",
        symbol: "Limits",
        resolved: false,
        neverTracked: false,
      },
    ],
    publicationGroup: "entrypoint",
    supersededBy: null,
    detectedAt: "2026-10-05T00:00:00.000Z",
    ...overrides,
  });
}

describe("document freshness finding", () => {
  it("maps staleness and reference evidence to reasons and a time-free digest", () => {
    const first = finding();
    expect(first.reasons).toEqual(["connected_path_deleted", "reference_target_missing"]);
    const later = finding({ detectedAt: "2026-10-06T00:00:00.000Z" });
    expect(later.findingDigest).toBe(first.findingDigest);
    expect(documentFreshnessFindingsDigest([later])).toBe(documentFreshnessFindingsDigest([first]));
    expect(finding({ documentHash: `sha256:${"e".repeat(64)}` }).findingDigest).not.toBe(
      first.findingDigest,
    );
  });

  it("drops unobserved evaluator reasons and keeps review-interval findings non-actionable", () => {
    const reviewOnly = finding({
      staleness: {
        reasons: ["review_interval_elapsed", "connected_path_unobserved"],
        verifiedRevision: null,
      },
      connectedPathChanges: [],
      references: [],
    });
    expect(reviewOnly.reasons).toEqual(["review_interval_elapsed"]);
  });
});

describe("document freshness priority and admission", () => {
  const content = "# Rules\n\nKeep this.\nHard risk limits live in `v2/engine.py: Limits`.\n";

  it("classifies safety from touched lines before entrypoint, canonical, and other", () => {
    expect(
      documentFreshnessPriorityClass({
        finding: finding(),
        content,
        policy: defaultDocumentFreshnessPolicy,
      }),
    ).toBe("entrypoint");
    expect(
      documentFreshnessPriorityClass({
        finding: finding({
          references: [
            {
              line: 4,
              target: "v2/engine.py",
              kind: "path_mention",
              symbol: null,
              resolved: false,
              neverTracked: false,
            },
          ],
        }),
        content,
        policy: defaultDocumentFreshnessPolicy,
      }),
    ).toBe("safety");
  });

  it("orders by class and admits within the cycle count and daily token budget", () => {
    const entries = ["d.md", "b.md", "a.md", "c.md"].map((path, index) => ({
      finding: finding({ documentPath: path, detectedAt: `2026-10-0${index + 1}T00:00:00.000Z` }),
      priorityClass: (["other", "safety", "canonical", "safety"] as const)[index]!,
    }));
    const ordered = orderDocumentFreshnessFindings(entries);
    expect(ordered.map((entry) => entry.finding.documentPath)).toEqual([
      "b.md",
      "c.md",
      "a.md",
      "d.md",
    ]);
    const admission = admitDocumentFreshnessFindings({
      ordered,
      candidates: [],
      holds: [],
      tokensUsedToday: 100_000,
      policy: defaultDocumentFreshnessPolicy,
      now: new Date("2026-10-05T00:00:00.000Z"),
    });
    expect(admission.admitted.map((entry) => entry.finding.documentPath)).toEqual(["b.md"]);
    expect(admission.skippedForBudget).toBe(3);
    expect(admission.skippedForCycleLimit).toBe(0);
    const cycleLimited = admitDocumentFreshnessFindings({
      ordered,
      candidates: [],
      holds: [],
      tokensUsedToday: 0,
      policy: { ...defaultDocumentFreshnessPolicy, maximumCandidatesPerCycle: 2 },
      now: new Date("2026-10-05T00:00:00.000Z"),
    });
    expect(cycleLimited.admitted).toHaveLength(2);
    expect(cycleLimited.skippedForCycleLimit).toBe(2);
  });

  it("never admits held, open, or settled findings", () => {
    const entry = { finding: finding(), priorityClass: "safety" as const };
    const now = new Date("2026-10-05T00:00:00.000Z");
    const base = {
      ordered: [entry],
      tokensUsedToday: 0,
      policy: defaultDocumentFreshnessPolicy,
      now,
    };
    expect(
      admitDocumentFreshnessFindings({
        ...base,
        candidates: [],
        holds: [
          {
            schemaVersion: 1,
            findingDigest: entry.finding.findingDigest,
            documentPath: "AGENTS.md",
            candidateId: "kfresh_000000000000000000000000",
            reason: "reverted",
            until: "2026-10-12T00:00:00.000Z",
          },
        ],
      }).skippedForHold,
    ).toBe(1);
    const candidate = {
      findingDigest: entry.finding.findingDigest,
      documentPath: "AGENTS.md",
      rejection: null,
    };
    expect(
      admitDocumentFreshnessFindings({
        ...base,
        holds: [],
        candidates: [{ ...candidate, state: "verified_pending_cross_check" }],
      }).skippedOpen,
    ).toBe(1);
    expect(
      admitDocumentFreshnessFindings({
        ...base,
        holds: [],
        candidates: [{ ...candidate, state: "applied" }],
      }).skippedSettled,
    ).toBe(1);
    // ADR-0561: exhausted attempts are Lervo debt, held until the backoff and then retried once.
    const rejected = {
      ...candidate,
      state: "rejected" as const,
      rejection: {
        reasonCode: "cross_check_disagreement" as const,
        rejectorKind: "cross_check" as const,
        contestedHunkIds: [],
      },
    };
    const exhausted = { ...base, holds: [], candidates: [rejected, rejected] };
    expect(admitDocumentFreshnessFindings(exhausted).skippedSettled).toBe(1);
    const debt = (retryAt: string) => [{ findingDigest: entry.finding.findingDigest, retryAt }];
    expect(
      admitDocumentFreshnessFindings({ ...exhausted, debt: debt("2026-10-06T00:00:00.000Z") })
        .skippedForHold,
    ).toBe(1);
    expect(
      admitDocumentFreshnessFindings({ ...exhausted, debt: debt("2026-10-04T00:00:00.000Z") })
        .admitted,
    ).toHaveLength(1);
  });
});

describe("document freshness classification and cross-check requirements", () => {
  const source =
    "# Rules\n\nThe guide lives in `ops/old.md`.\n- Use `pnpm check` before commits.\n";
  const range = (text: string) => {
    const start = Buffer.from(source).indexOf(text);
    return { startByte: start, endByte: start + Buffer.byteLength(text) };
  };

  it("derives factual, statement, and safety classes deterministically", () => {
    const guide = range("`ops/old.md`");
    const classify = (replacement: string, evidence: string, path = "docs/guide.md") =>
      classifyDocumentFreshnessHunk({
        documentPath: path,
        source,
        range: guide,
        replacement,
        citedEvidenceText: evidence,
        safetyPatterns: defaultDocumentFreshnessPolicy.safetyPatterns,
      });
    expect(classify("`ops/new.md`", "ops/new.md\n# New")).toBe("factual_reference");
    expect(classify("the new operations handbook", "ops/new.md")).toBe("statement");
    expect(
      classifyDocumentFreshnessHunk({
        documentPath: "AGENTS.md",
        source,
        range: range("`pnpm check`"),
        replacement: "`pnpm verify`",
        citedEvidenceText: "pnpm verify",
        safetyPatterns: [],
      }),
    ).toBe("safety_or_policy");
    expect(documentFreshnessInstructionLine("- Never overwrite user-owned content.")).toBe(true);
    expect(documentFreshnessInstructionLine("Generated routes are listed below.")).toBe(false);
  });

  it("requires two independent agreements for safety, user-owned statements, and archives", () => {
    const agreements = (
      ownership: "lervo_managed" | "user_owned",
      changeClass: "factual_reference" | "statement" | "safety_or_policy" | null,
      operation: "edit" | "archive" = "edit",
    ) => documentFreshnessRequiredAgreements({ ownership, changeClass, operation });
    expect(agreements("lervo_managed", "statement")).toBe(1);
    expect(agreements("user_owned", "factual_reference")).toBe(1);
    expect(agreements("user_owned", "statement")).toBe(2);
    expect(agreements("lervo_managed", "safety_or_policy")).toBe(2);
    expect(agreements("user_owned", null, "archive")).toBe(2);
    const policy = defaultDocumentFreshnessPolicy;
    expect(
      documentFreshnessCrossCheckRequired({
        ownership: "lervo_managed",
        changeClass: "factual_reference",
        operation: "edit",
        policy,
      }),
    ).toBe(false);
    expect(
      documentFreshnessCrossCheckRequired({
        ownership: "lervo_managed",
        changeClass: "statement",
        operation: "edit",
        policy,
      }),
    ).toBe(true);
    expect(
      documentFreshnessCrossCheckRequired({
        ownership: "user_owned",
        changeClass: "factual_reference",
        operation: "edit",
        policy: { crossCheck: "never" },
      }),
    ).toBe(true);
  });

  it("resolves managed-block ranges and document ownership", () => {
    const managed =
      "# A\n\n<!-- lervo:begin block=routes schema=1 -->\nRoutes are in `a.md`.\n<!-- lervo:end block=routes -->\n\nUser `b.md`.\n";
    const at = (text: string) => {
      const start = Buffer.from(managed).indexOf(text);
      return { startByte: start, endByte: start + Buffer.byteLength(text) };
    };
    expect(
      documentFreshnessRangeOwnership({
        bytes: bytes(managed),
        documentOwnership: "user_owned",
        range: at("`a.md`"),
      }),
    ).toEqual({
      ownership: "lervo_managed",
      managedBlockId: "routes",
    });
    expect(
      documentFreshnessRangeOwnership({
        bytes: bytes(managed),
        documentOwnership: "user_owned",
        range: at("`b.md`"),
      }),
    ).toEqual({
      ownership: "user_owned",
      managedBlockId: null,
    });
    expect(
      documentFreshnessRangeOwnership({
        bytes: bytes(managed),
        documentOwnership: "user_owned",
        range: at("routes schema=1 -->\nRoutes"),
      }),
    ).toBeNull();
    const generated =
      "# A\n\n<!-- lervo:begin block=routes schema=2 -->\nRoutes `a.md`.\n<!-- lervo:end block=routes -->\n\nUser `b.md`.\n";
    const generatedAt = (text: string) => {
      const start = Buffer.from(generated).indexOf(text);
      return { startByte: start, endByte: start + Buffer.byteLength(text) };
    };
    expect(lervoManagedRegions(bytes(generated))).toMatchObject([{ blockId: "routes", schema: 2 }]);
    expect(
      documentFreshnessRangeOwnership({
        bytes: bytes(generated),
        documentOwnership: "user_owned",
        range: generatedAt("`a.md`"),
      }),
    ).toBeNull();
    expect(
      documentFreshnessRangeOwnership({
        bytes: bytes(generated),
        documentOwnership: "user_owned",
        range: generatedAt("`b.md`"),
      }),
    ).toEqual({ ownership: "user_owned", managedBlockId: null });
    expect(
      documentFreshnessDocumentOwnership({
        documentPath: "docs/knowledge/a.md",
        publicationRoot: "docs/knowledge",
        roles: [],
      }),
    ).toBe("lervo_managed");
    expect(
      documentFreshnessDocumentOwnership({
        documentPath: "README.md",
        publicationRoot: "docs/knowledge",
        roles: [{ path: "README.md", lifecycleOwner: "user", rewritePolicy: "repository_tool" }],
      }),
    ).toBe("user_owned");
  });
});

describe("document freshness hunks", () => {
  it("locates exact unique text, applies from the end, and measures minimal changed bytes", () => {
    const source = bytes("alpha beta gamma\nalpha delta\n");
    expect(locateDocumentFreshnessHunks(source, ["alpha"])).toMatchObject({
      status: "invalid",
      reason: "ambiguous",
    });
    expect(locateDocumentFreshnessHunks(source, ["omega"])).toMatchObject({
      status: "invalid",
      reason: "not_found",
    });
    expect(locateDocumentFreshnessHunks(source, ["beta gamma", "gamma\nalpha"])).toMatchObject({
      reason: "overlapping",
    });
    const location = locateDocumentFreshnessHunks(source, ["beta", "delta"]);
    if (location.status !== "located") throw new Error("expected located hunks");
    const hunks = [
      { range: location.ranges[0]!, replacement: "BETA" },
      { range: location.ranges[1]!, replacement: "epsilon" },
    ];
    const output = applyDocumentFreshnessHunks(source, hunks);
    expect(Buffer.from(output).toString("utf8")).toBe("alpha BETA gamma\nalpha epsilon\n");
    expect(documentFreshnessOutsideBytesUnchanged(source, output, hunks)).toBe(true);
    expect(documentFreshnessOutsideBytesUnchanged(source, bytes("changed"), hunks)).toBe(false);
    expect(documentFreshnessChangedBytes(source, hunks)).toBe(4 + 7);
  });
});

describe("document freshness provider response", () => {
  it("accepts only the response contract", () => {
    const hash = `sha256:${"f".repeat(64)}`;
    const valid = {
      operation: "edit",
      hunks: [
        {
          before: "a",
          after: "b",
          claims: [{ text: "Moved.", evidence: [{ path: "x.md", hash }] }],
        },
      ],
      archiveName: null,
      currentDocumentPath: null,
      explanation: "",
    };
    expect(parseDocumentFreshnessProposal(valid)?.hunks).toHaveLength(1);
    expect(parseDocumentFreshnessProposal({ ...valid, hunks: [] })).toBeNull();
    expect(parseDocumentFreshnessProposal({ ...valid, operation: "rewrite" })).toBeNull();
    expect(
      parseDocumentFreshnessProposal({
        ...valid,
        hunks: [
          { ...valid.hunks[0], claims: [{ text: "x", evidence: [{ path: "x", hash: "nope" }] }] },
        ],
      }),
    ).toBeNull();
    expect(
      parseDocumentFreshnessProposal({ ...valid, operation: "no_change_needed", hunks: [] })
        ?.operation,
    ).toBe("no_change_needed");
  });
});

describe("document freshness archive", () => {
  it("rebases outgoing links and rewrites inbound links outside fenced code", () => {
    const rewritten = rewriteDocumentLinks({
      documentPath: "docs/a.md",
      content: "[x](b.md#part)\n```\n[y](b.md)\n```\n[ref]: ./b.md\n[web](https://example.com)\n",
      rewrite: (target) => (target === "docs/b.md" ? "../c.md" : null),
    });
    expect(rewritten.content).toBe(
      "[x](../c.md#part)\n```\n[y](b.md)\n```\n[ref]: ../c.md\n[web](https://example.com)\n",
    );
    expect(rewritten.rewrites).toHaveLength(2);
    const plan = planDocumentFreshnessArchive({
      documentPath: "FINAL.md",
      content: "# Final\n\n[spec](docs/spec.md)\n",
      historicalRoot: "docs/archive",
      suggestedName: "v1-final.md",
      currentDocumentPath: "docs/spec.md",
      archivedOn: "2026-10-05",
      ownership: "user_owned",
      inboundDocuments: [{ path: "docs/notes/n.md", content: "[f](../../FINAL.md)\n" }],
    });
    expect(plan.targetPath).toBe("docs/archive/v1-final.md");
    expect(plan.banner).toBe(
      "> Historical: archived on 2026-10-05. The current document is [docs/spec.md](../spec.md).\n\n",
    );
    expect(plan.outgoingLinkRewrites[0]).toMatchObject({ from: "docs/spec.md", to: "../spec.md" });
    expect(plan.inboundLinkRewrites[0]).toMatchObject({
      path: "docs/notes/n.md",
      to: "../archive/v1-final.md",
    });
  });
});

describe("document freshness surfaces", () => {
  const summary = {
    staleCount: 2,
    safetyCount: 1,
    firstSafetyPath: "AGENTS.md",
    awaitingReviewCount: 1,
    appliedRecentPaths: ["README.md"],
    blocked: false,
  };

  it("renders a bounded compact line and turn-report segment only when counts are non-zero", () => {
    const line = documentFreshnessCompactLine(summary)!;
    expect(line).toBe(
      "Document freshness (no owner action): 2 stale (1 safety: AGENTS.md), 1 candidate held by Lervo, 1 refreshed; lervo knowledge freshness status",
    );
    expect(Buffer.byteLength(line)).toBeLessThanOrEqual(200);
    expect(
      Buffer.byteLength(
        documentFreshnessCompactLine({ ...summary, firstSafetyPath: "x".repeat(400) })!,
      ),
    ).toBeLessThanOrEqual(200);
    expect(
      documentFreshnessCompactLine({
        ...summary,
        staleCount: 0,
        safetyCount: 0,
        awaitingReviewCount: 0,
        appliedRecentPaths: [],
      }),
    ).toBeNull();
    expect(documentFreshnessTurnReportSegment(summary)).toBe(
      "docs: 1 refreshed (README.md), 1 held by Lervo",
    );
  });
});

describe("document freshness publication group", () => {
  it("classifies historical, generated, entrypoint, canonical, and other documents", () => {
    const group = (path: string, content = "# Title\n") =>
      documentFreshnessPublicationGroup({
        path,
        content,
        publicationRoot: "docs/knowledge",
        archiveScopes: ["docs/archive"],
        rolePaths: new Set(["docs/guide/product.md"]),
      });
    expect(group("docs/archive/v1.md")).toBe("historical");
    expect(group("docs/design.md", "> Historical: replaced by v4.\n")).toBe("historical");
    expect(group("docs/knowledge/index.md")).toBe("generated");
    expect(group("AGENTS.md")).toBe("entrypoint");
    expect(group("packages/core/README.md")).toBe("entrypoint");
    expect(group("docs/README.md")).toBe("other");
    expect(group("docs/specifications/a.md")).toBe("canonical");
    expect(group("docs/guide/product.md")).toBe("canonical");
  });
});

describe("document freshness policy", () => {
  it("validates the optional policy section and keeps defaults for absent keys", () => {
    expect(documentFreshnessPolicySectionValid(undefined)).toBe(true);
    expect(
      documentFreshnessPolicySectionValid({ maximumTokensPerDay: 150_000, crossCheck: "always" }),
    ).toBe(true);
    expect(documentFreshnessPolicySectionValid({ maximumEditRatio: 2 })).toBe(false);
    expect(documentFreshnessPolicySectionValid({ unknown: true })).toBe(false);
    expect(documentFreshnessPolicySectionValid({ historicalRoot: "../outside" })).toBe(false);
    expect(() =>
      validateRepositoryKnowledgePolicy({
        ...defaultRepositoryKnowledgePolicy,
        documentFreshness: { holdDays: 0 },
      }),
    ).toThrow();
    expect(
      validateRepositoryKnowledgePolicy({
        ...defaultRepositoryKnowledgePolicy,
        documentFreshness: { holdDays: 3 },
      }).documentFreshness,
    ).toEqual({ holdDays: 3 });
  });
});

export type { DocumentFreshnessFindingV1 };

describe("unresolved references in freshness generation", () => {
  it("tells the generator that no_change_needed cannot settle an unresolved reference", async () => {
    const { documentFreshnessGenerationInstruction } =
      await import("../src/document-freshness-response.js");
    expect(documentFreshnessGenerationInstruction).toContain(
      "When untrustedSourceData.unresolvedReferences is not empty, no_change_needed is never accepted",
    );
    expect(documentFreshnessGenerationInstruction).toContain(
      "append ` (removed)` to that same line",
    );
  });

  it("accepts a removed target that its own line marks as removed", async () => {
    const { unresolvedDocumentReferences } =
      await import("../src/document-freshness-references.js");
    const oracle = {
      exists: (path: string) => path === "docs/current.md",
      readText: () => null,
      topLevel: (segment: string) => ["docs", "packages"].includes(segment),
    };
    const before = "# Evidence\n\nThe check read `packages/runtime/test/._worker.test.ts`.\n";
    const after =
      "# Evidence\n\nThe check read `packages/runtime/test/._worker.test.ts` (removed).\n";
    expect(
      unresolvedDocumentReferences({ path: "docs/evidence/a.md", content: before, oracle }),
    ).toHaveLength(1);
    expect(
      unresolvedDocumentReferences({ path: "docs/evidence/a.md", content: after, oracle }),
    ).toEqual([]);
  });
});
