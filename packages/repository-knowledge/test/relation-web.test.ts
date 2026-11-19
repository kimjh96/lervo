import { describe, expect, it } from "vitest";

import { extractRelationDocument } from "../src/relation-web-extraction.js";
import { extractRelationMentions } from "../src/relation-web-mentions.js";
import { buildRelationWeb, type RelationWebInput } from "../src/relation-web.js";
import { relationWebStats } from "../src/relation-web-stats.js";

function input(overrides: Partial<RelationWebInput> = {}): RelationWebInput {
  return {
    documents: [],
    trackedFiles: [],
    packages: [],
    commands: [],
    lineage: [],
    archiveScopes: ["docs/archive"],
    observedRevision: "rev1",
    ...overrides,
  };
}

describe("relation web mentions", () => {
  it("finds packages, commands, and bare ADR numbers with their strength", () => {
    expect(
      extractRelationMentions(
        [
          "Use `lervo knowledge query --json <q>` or run lervo upgrade on each host.",
          "The `@lervo/cli` package and @lervo/repository-knowledge, not lervo-wt or @lervo.",
          "See ADR-0560 and [ADR-0561](x.md).",
          "```bash",
          "lervo loop status --root .",
          "ADR-0001 in a fence is code",
          "```",
        ].join("\n"),
      ),
    ).toEqual([
      { kind: "command", name: "lervo knowledge query", line: 1, strong: true },
      { kind: "command", name: "lervo upgrade on each host", line: 1, strong: false },
      { kind: "package", name: "@lervo/cli", line: 2, strong: true },
      { kind: "package", name: "@lervo/repository-knowledge", line: 2, strong: true },
      { kind: "adr", name: "0560", line: 3, strong: false },
      { kind: "command", name: "lervo loop status", line: 5, strong: true },
    ]);
  });

  it("indexes a mention under the longest catalog command or its command group", () => {
    const { web } = buildRelationWeb(
      input({
        documents: [
          {
            path: "docs/a.md",
            content:
              "`lervo knowledge query`, run lervo upgrade on each host, `lervo loop`, `lervo unknown thing`\n",
            role: "x",
          },
        ],
        commands: ["lervo knowledge query", "lervo knowledge", "lervo upgrade", "lervo loop run"],
      }),
    );
    expect([...web.inbound.keys()].filter((node) => node.startsWith("command:")).sort()).toEqual([
      "command:lervo knowledge query",
      "command:lervo loop",
      "command:lervo unknown thing",
      "command:lervo upgrade",
    ]);
    expect(relationWebStats(web).unresolvedCommandMentions).toBe(1);
  });
});

describe("relation web extraction", () => {
  it("records every relation once with evidence", () => {
    const extraction = extractRelationDocument({
      path: "docs/decisions/0010-example.md",
      content: [
        "# ADR-0010: Example",
        "",
        "Status: `accepted`",
        "Amends: [ADR-0009](0009-base.md)",
        "",
        "## Decision",
        "",
        "Edit `packages/core/src/a.ts` and `scripts/run` with `lervo knowledge lint`.",
        "It follows ADR-0009 and ADR-0008, using @lervo/core. See [spec](../spec.md).",
      ].join("\n"),
      observedRevision: "rev1",
    });
    expect(extraction.adr).toBe("0010");
    expect(extraction.status).toBe("accepted");
    expect(extraction.truncated).toBe(false);
    expect(
      extraction.edges.map(
        (edge) =>
          `${edge.kind} ${edge.from} -> ${edge.to} @${edge.evidence.line} ${edge.evidence.strength}`,
      ),
    ).toEqual([
      "links_to path:docs/decisions/0010-example.md -> path:docs/decisions/0009-base.md @4 strong",
      "names_path path:docs/decisions/0010-example.md -> path:packages/core/src/a.ts @8 strong",
      "names_path path:docs/decisions/0010-example.md -> path:scripts/run @8 weak",
      "links_to path:docs/decisions/0010-example.md -> path:docs/spec.md @9 strong",
      "amends path:docs/decisions/0010-example.md -> path:docs/decisions/0009-base.md @4 header",
      "names_command path:docs/decisions/0010-example.md -> command:lervo knowledge lint @8 strong",
      "names_package path:docs/decisions/0010-example.md -> package:@lervo/core @9 strong",
      "names_adr path:docs/decisions/0010-example.md -> adr:0009 @9 weak",
      "names_adr path:docs/decisions/0010-example.md -> adr:0008 @9 weak",
    ]);
    expect(extraction.edges[0]!.evidence).toEqual({
      extractorVersion: 1,
      sourceDocument: "docs/decisions/0010-example.md",
      line: 4,
      strength: "strong",
      observedRevision: "rev1",
    });
  });
});

describe("relation web build", () => {
  const documents = [
    {
      path: "docs/a.md",
      content: "# A\n\nSee `packages/x/src/x.ts`.\n",
      role: "canonical_documents",
    },
    { path: "docs/b.md", content: "# B\n\nStatus: `superseded`\n", role: "canonical_documents" },
  ];

  it("reuses an unchanged extraction and extracts only changed bytes", () => {
    const first = buildRelationWeb(input({ documents }));
    expect([first.extracted, first.reused]).toEqual([2, 0]);
    const second = buildRelationWeb(
      input({
        documents: [documents[0]!, { ...documents[1]!, content: "# B\n\nChanged.\n" }],
        observedRevision: "rev2",
      }),
      first.web.documents,
    );
    expect([second.extracted, second.reused]).toEqual([1, 1]);
    expect(second.web.documents.get("docs/a.md")!.observedRevision).toBe("rev1");
    expect(second.web.documents.get("docs/b.md")!.observedRevision).toBe("rev2");
    expect(first.web.documents.get("docs/b.md")!.historical).toBe(true);
    expect(second.web.documents.get("docs/b.md")!.historical).toBe(false);
  });

  it("leaves an ADR number carried by two documents unresolved and counts it", () => {
    const { web } = buildRelationWeb(
      input({
        documents: [
          { path: "docs/decisions/a/0357-one.md", content: "# ADR-0357: One\n", role: "x" },
          { path: "docs/decisions/b/0357-two.md", content: "# ADR-0357: Two\n", role: "x" },
          {
            path: "docs/decisions/0358-three.md",
            content: "# Three\n\nSee ADR-0357.\n",
            role: "x",
          },
        ],
        commands: ["lervo knowledge lint"],
      }),
    );
    expect(web.adrDocuments.get("0358")).toBe("docs/decisions/0358-three.md");
    expect(web.adrDocuments.has("0357")).toBe(false);
    expect(web.ambiguousAdrNumbers.get("0357")).toEqual([
      "docs/decisions/a/0357-one.md",
      "docs/decisions/b/0357-two.md",
    ]);
    const stats = relationWebStats(web);
    expect(stats.ambiguousAdrNumbers).toBe(1);
    expect(stats.edgesByKind.names_adr).toEqual({ weak: 1 });
    expect(stats.nodes.command).toBe(1);
  });
});
