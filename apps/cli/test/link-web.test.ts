import { describe, expect, it } from "vitest";

import { buildDocumentLinkWeb } from "@lervo/repository-knowledge";

describe("document link web", () => {
  it("finds broken links, orphan canonical documents, and amendments not linked back", () => {
    const documents = [
      {
        path: "docs/decisions/0002-new.md",
        content: "# New\n\nAmends: [ADR-0001](0001-old.md)\n\nSee [missing](0009-gone.md).\n",
      },
      { path: "docs/decisions/0001-old.md", content: "# Old\n\nNo back-link.\n" },
      {
        path: "docs/decisions/0003-linked.md",
        content: "# Linked\n\nAmends: [ADR-0001](0001-old.md)\n",
      },
      { path: "docs/index.md", content: "[New](decisions/0002-new.md)\n" },
      {
        path: "docs/decisions/0000-history.md",
        content: "---\nstatus: superseded\n---\n# History\n\n[gone](nowhere.md)\n",
      },
    ];
    const web = buildDocumentLinkWeb({
      documents,
      trackedPaths: new Set([
        ...documents.map((document) => document.path),
        "docs",
        "docs/decisions",
      ]),
      canonical: (path) => path.startsWith("docs/decisions/"),
      archiveScopes: ["docs/archive"],
    });
    expect(web.broken).toEqual([
      { path: "docs/decisions/0002-new.md", line: 5, target: "docs/decisions/0009-gone.md" },
    ]);
    expect(web.orphans).toEqual(["docs/decisions/0003-linked.md"]);
    expect(web.missingBacklinks).toEqual([
      { path: "docs/decisions/0002-new.md", target: "docs/decisions/0001-old.md" },
      { path: "docs/decisions/0003-linked.md", target: "docs/decisions/0001-old.md" },
    ]);
  });
});

describe("link web projection", () => {
  it("rebuilds only when tracked Markdown changes and ignores generated outputs", async () => {
    const { execFileSync } = await import("node:child_process");
    const { mkdir, mkdtemp, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const { serializeDecisionTaxonomy } = await import("@lervo/project");
    const { readLinkWeb, refreshLinkWeb } = await import("../src/link-web-projection.js");
    const root = await mkdtemp(join(tmpdir(), "lervo-link-web-"));
    execFileSync("git", ["-C", root, "init", "-q"]);
    await mkdir(join(root, ".lervo/knowledge"), { recursive: true });
    await mkdir(join(root, ".lervo/generated"), { recursive: true });
    await mkdir(join(root, "docs"), { recursive: true });
    await writeFile(
      join(root, ".lervo/knowledge/document-layout.yaml"),
      serializeDecisionTaxonomy(),
    );
    await writeFile(join(root, ".lervo/generated/out.md"), "[x](missing.md)\n");
    await writeFile(join(root, "docs/guide.md"), "# Guide\n\n[gone](gone.md)\n");
    const first = await refreshLinkWeb(root, new Date("2026-11-01T00:00:00Z"));
    expect(first).toMatchObject({ documentCount: 1, brokenCount: 1 });
    const again = await refreshLinkWeb(root, new Date("2026-11-01T01:00:00Z"));
    expect(again.observedAt).toBe(first.observedAt);
    await writeFile(join(root, "docs/guide.md"), "# Guide\n\nFixed, no links at all now.\n");
    const rebuilt = await refreshLinkWeb(root, new Date("2026-11-01T02:00:00Z"));
    expect(rebuilt).toMatchObject({ brokenCount: 0, observedAt: "2026-11-01T02:00:00.000Z" });
    expect(await readLinkWeb(root)).toEqual(rebuilt);
  });
});
