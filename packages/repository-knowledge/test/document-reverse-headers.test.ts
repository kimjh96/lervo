import { describe, expect, it } from "vitest";

import {
  documentFreshnessAutoApplicableHunks,
  documentFreshnessUserOwnedChange,
} from "../src/document-freshness-candidate-state.js";
import { documentFreshnessPolicy } from "../src/document-freshness-policy.js";
import { missingReverseHeaders } from "../src/document-lifecycle-resolution.js";
import { reverseHeaderCandidate } from "../src/document-reverse-header-candidate.js";
import {
  planReverseHeaderEdit,
  reverseHeaderDeclarations,
  type ReverseHeaderDeclaration,
} from "../src/document-reverse-headers.js";
import { sha256 } from "../src/integrity.js";
import { buildRelationWeb } from "../src/relation-web.js";

/** A body long enough that a header line stays within the edit bound, as in a real record. */
const BODY = "Keep it. The decision holds for every host and every repository.\n".repeat(4);

const documents: Record<string, string> = {
  "docs/decisions/0001-base.md":
    "# ADR-0001: Base\n\nStatus: `accepted`\nAmended by: [ADR-0003](0003-amend.md)\n\n## Context\n",
  "docs/decisions/0002-split.md":
    "# ADR-0002: Split\n\nStatus: `accepted`\nDecision date: 2026-01-02\nRelated: [ADR-0001](0001-base.md)\n\n## Decision\n\n" +
    BODY,
  "docs/decisions/0003-amend.md":
    "# ADR-0003: Amend\n\nStatus: `accepted`\nAmends: [ADR-0001](0001-base.md), [ADR-0002](0002-split.md)\nSupersedes in part: [ADR-0004](0004-part.md) (Retry)\n",
  "docs/decisions/0004-part.md": "# ADR-0004: Part\n\nStatus: `accepted`\n",
  "docs/decisions/0005-new.md":
    "# ADR-0005: New\n\nStatus: `accepted`\nSupersedes: [ADR-0006](0006-old.md)\n",
  "docs/decisions/0006-old.md": "# ADR-0006: Old\n\nStatus: `accepted`\n",
  "docs/decisions/sync/0007-far.md":
    "# ADR-0007: Far\n\nStatus: `accepted`\nAmends: [ADR-0002](../0002-split.md)\n",
};

function web(overrides: Record<string, string> = {}) {
  const all = { ...documents, ...overrides };
  return buildRelationWeb({
    documents: Object.entries(all).map(([path, content]) => ({
      path,
      content,
      role: "canonical_documents",
    })),
    trackedFiles: Object.keys(all),
    packages: [],
    commands: [],
    lineage: [],
    archiveScopes: ["docs/archive"],
    observedRevision: "rev",
  }).web;
}

function declare(
  kind: ReverseHeaderDeclaration["kind"],
  by: string,
  adr: string,
  part?: string,
): ReverseHeaderDeclaration {
  return { kind, by, adr, ...(part === undefined ? {} : { part }) };
}

function planned(path: string, content: string, declarations: ReverseHeaderDeclaration[]) {
  const plan = planReverseHeaderEdit({ path, content, declarations });
  if (plan.status !== "planned") throw new Error(`skipped: ${plan.reason}`);
  // The edit only inserts: removing the replacement gives the source back.
  const at = Buffer.from(content).subarray(0, plan.startByte).toString("utf8").length;
  expect(plan.output.slice(0, at) + plan.output.slice(at + plan.replacement.length)).toBe(content);
  return plan.output;
}

describe("reverse header declarations", () => {
  it("lists amendment and named-part lines another ADR declares, never a full supersession", () => {
    const relation = web();
    const of = (path: string) => reverseHeaderDeclarations(relation, relation.documents.get(path)!);
    expect(of("docs/decisions/0001-base.md")).toEqual([]);
    expect(of("docs/decisions/0002-split.md")).toEqual([
      declare("amended", "docs/decisions/0003-amend.md", "0003"),
      declare("amended", "docs/decisions/sync/0007-far.md", "0007"),
    ]);
    expect(of("docs/decisions/0004-part.md")).toEqual([
      declare("superseded_in_part", "docs/decisions/0003-amend.md", "0003", "Retry"),
    ]);
    // Declaring a superseded status would overwrite the owner's `Status:` line.
    expect(of("docs/decisions/0006-old.md")).toEqual([]);
  });

  it("writes lines that settle the mechanical reasons and plans nothing a second time", () => {
    const relation = web();
    const output = planned(
      "docs/decisions/0002-split.md",
      documents["docs/decisions/0002-split.md"]!,
      reverseHeaderDeclarations(relation, relation.documents.get("docs/decisions/0002-split.md")!),
    );
    const after = web({ "docs/decisions/0002-split.md": output });
    const document = after.documents.get("docs/decisions/0002-split.md")!;
    expect(missingReverseHeaders(after, document)).toEqual([]);
    expect(reverseHeaderDeclarations(after, document)).toEqual([]);
  });
});

describe("reverse header edit plan", () => {
  it("inserts after the last status, date, supersession, or amendment line, before Related", () => {
    expect(
      planned("docs/decisions/0002-split.md", documents["docs/decisions/0002-split.md"]!, [
        declare("amended", "docs/decisions/0003-amend.md", "0003"),
        declare("amended", "docs/decisions/sync/0007-far.md", "0007"),
      ]),
    ).toBe(
      "# ADR-0002: Split\n\nStatus: `accepted`\nDecision date: 2026-01-02\nAmended by: [ADR-0003](0003-amend.md), [ADR-0007](sync/0007-far.md)\nRelated: [ADR-0001](0001-base.md)\n\n## Decision\n\n" +
        BODY,
    );
  });

  it("adds a new line below an existing Amended by line or its list, never editing it", () => {
    expect(
      planned(
        "docs/decisions/0001-base.md",
        "# ADR-0001: Base\n\nStatus: `accepted`\nAmended by: [ADR-0003](0003-amend.md). Read it first.\n\n## Context\n",
        [declare("amended", "docs/decisions/0008-later.md", "0008")],
      ),
    ).toBe(
      "# ADR-0001: Base\n\nStatus: `accepted`\nAmended by: [ADR-0003](0003-amend.md). Read it first.\nAmended by: [ADR-0008](0008-later.md)\n\n## Context\n",
    );
    expect(
      planned(
        "docs/decisions/0001-base.md",
        "# ADR-0001: Base\n\nStatus: `accepted`\nAmends:\n\n- [ADR-0000](0000-root.md)\n- [ADR-0009](0009-other.md)\n\nPart of: [ADR-0010](0010-whole.md)\n",
        [declare("amended", "docs/decisions/0008-later.md", "0008")],
      ),
    ).toBe(
      "# ADR-0001: Base\n\nStatus: `accepted`\nAmends:\n\n- [ADR-0000](0000-root.md)\n- [ADR-0009](0009-other.md)\nAmended by: [ADR-0008](0008-later.md)\n\nPart of: [ADR-0010](0010-whole.md)\n",
    );
  });

  it("names a superseded part, keeps CRLF and front matter, and links across directories", () => {
    expect(
      planned(
        "docs/decisions/sync/0004-part.md",
        "---\ntitle: Part\n---\n# ADR-0004: Part\r\n\r\nStatus: `accepted`\r\n\r\n## Context\r\n",
        [
          declare("amended", "docs/decisions/0003-amend.md", "0003"),
          declare("superseded_in_part", "docs/decisions/0003-amend.md", "0003", "Retry (old)"),
        ],
      ),
    ).toBe(
      "---\ntitle: Part\n---\n# ADR-0004: Part\r\n\r\nStatus: `accepted`\r\nAmended by: [ADR-0003](../0003-amend.md)\r\nSuperseded in part by: [ADR-0003](../0003-amend.md) (Retry old)\r\n\r\n## Context\r\n",
    );
  });

  it("refuses a record without a Status line or with no room in its header", () => {
    const declarations = [declare("amended", "docs/decisions/0003-amend.md", "0003")];
    expect(
      planReverseHeaderEdit({
        path: "docs/decisions/0009-loose.md",
        content: "# ADR-0009: Loose\n\nAmends nothing.\n",
        declarations,
      }),
    ).toEqual({ status: "skipped", reason: "no_status_line" });
    // A Status line on header line 80 leaves no room for a line the grammar would read.
    const crowded = `${"x\n".repeat(79)}Status: \`accepted\`\n\n## Context\n`;
    expect(
      planReverseHeaderEdit({
        path: "docs/decisions/0009-loose.md",
        content: crowded,
        declarations,
      }),
    ).toEqual({ status: "skipped", reason: "self_check_failed" });
    expect(
      planReverseHeaderEdit({
        path: "docs/decisions/0009-loose.md",
        content: "# ADR-0009\n\nStatus: `accepted`\n",
        declarations: [],
      }),
    ).toEqual({ status: "skipped", reason: "self_check_failed" });
    // A line that would push the record past the documentation bound is not written.
    const long = `# ADR-0009\n\nStatus: \`accepted\`\n\n## Context\n\n${"y".repeat(16_340)}\n`;
    expect(
      planReverseHeaderEdit({ path: "docs/decisions/0009-loose.md", content: long, declarations }),
    ).toEqual({ status: "skipped", reason: "document_bound" });
    const tall = `# ADR-0009\n\nStatus: \`accepted\`\n\n## Context\n${"z\n".repeat(234)}`;
    expect(
      planReverseHeaderEdit({ path: "docs/decisions/0009-loose.md", content: tall, declarations }),
    ).toEqual({ status: "skipped", reason: "document_bound" });
  });
});

describe("reverse header candidate", () => {
  const oracle = {
    exists: (path: string) => path in documents,
    readText: (path: string) => documents[path] ?? null,
    topLevel: (segment: string) => segment === "docs",
  };

  function candidate(ownership: "user_owned" | "lervo_managed" = "user_owned") {
    const path = "docs/decisions/0002-split.md";
    const by = "docs/decisions/0003-amend.md";
    return reverseHeaderCandidate({
      documentPath: path,
      adr: "0002",
      source: new Uint8Array(Buffer.from(documents[path]!)),
      declarations: [declare("amended", by, "0003")],
      declaringHashes: { [by]: sha256(Buffer.from(documents[by]!)) },
      documentOwnership: ownership,
      policy: documentFreshnessPolicy({} as never),
      oracle,
      detectedAt: "2026-11-24T00:00:00.000Z",
      now: "2026-11-24T00:00:00.000Z",
    });
  }

  it("is a verified insert-only edit that applies although the record is user-owned", () => {
    const built = candidate()!;
    expect(built).toMatchObject({
      state: "verified",
      operation: "edit",
      crossCheck: "not_required",
      tokensObserved: 0,
      mechanical: { kind: "reverse_header" },
    });
    expect(built.checks.every((check) => check.status === "passed")).toBe(true);
    expect(built.hunks).toHaveLength(1);
    expect(built.hunks[0]!.range.startByte).toBe(built.hunks[0]!.range.endByte);
    expect(documentFreshnessUserOwnedChange(built)).toBe(false);
    expect(documentFreshnessAutoApplicableHunks(built)).toEqual(built.hunks);
  });

  it("keeps invariant 5 for any other user-owned hunk", () => {
    const built = candidate()!;
    const { mechanical: _marker, ...plain } = built;
    expect(documentFreshnessUserOwnedChange(plain)).toBe(true);
    expect(documentFreshnessAutoApplicableHunks(plain)).toEqual([]);
    // A reverse header marker never makes a replacing hunk applicable.
    const replacing = {
      ...built,
      hunks: built.hunks.map((hunk) => ({
        ...hunk,
        range: { startByte: hunk.range.startByte, endByte: hunk.range.startByte + 1 },
      })),
    };
    expect(documentFreshnessUserOwnedChange(replacing)).toBe(true);
    expect(documentFreshnessAutoApplicableHunks(replacing)).toEqual([]);
  });

  it("judges only the inserted references, so an older broken link elsewhere does not block it", () => {
    const path = "docs/decisions/0002-split.md";
    const by = "docs/decisions/0003-amend.md";
    const build = (content: string, exists: (target: string) => boolean) =>
      reverseHeaderCandidate({
        documentPath: path,
        adr: "0002",
        source: new Uint8Array(Buffer.from(content)),
        declarations: [declare("amended", by, "0003")],
        declaringHashes: { [by]: sha256(Buffer.from(documents[by]!)) },
        documentOwnership: "user_owned",
        policy: documentFreshnessPolicy({} as never),
        oracle: { ...oracle, exists },
        detectedAt: "2026-11-24T00:00:00.000Z",
        now: "2026-11-24T00:00:00.000Z",
      });
    const withBrokenLink = `${documents[path]!}See [the old guide](../missing-guide.md).\n`;
    const built = build(withBrokenLink, (target) => target in documents)!;
    expect(built.checks.find((check) => check.code === "references_resolve")).toEqual({
      code: "references_resolve",
      status: "passed",
      detail: "inserted_references_resolve",
    });
    // A declaring record the tree does not hold would add a broken link: nothing is built.
    expect(build(documents[path]!, (target) => target !== by)).toBeNull();
  });

  it("is not built when a declaring record has no committed bytes", () => {
    const path = "docs/decisions/0002-split.md";
    expect(
      reverseHeaderCandidate({
        documentPath: path,
        adr: "0002",
        source: new Uint8Array(Buffer.from(documents[path]!)),
        declarations: [declare("amended", "docs/decisions/0003-amend.md", "0003")],
        declaringHashes: {},
        documentOwnership: "user_owned",
        policy: documentFreshnessPolicy({} as never),
        oracle,
        detectedAt: "2026-11-24T00:00:00.000Z",
        now: "2026-11-24T00:00:00.000Z",
      }),
    ).toBeNull();
  });
});
