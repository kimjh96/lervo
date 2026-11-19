import { describe, expect, it } from "vitest";

import {
  documentNamedIdentifiers,
  documentRecordsRemoval,
  missingReverseHeaders,
  namesTouchedByChange,
  resolveLifecycleReason,
} from "../src/document-lifecycle-resolution.js";
import type { RelationSuspectEvidence } from "../src/relation-web-suspects.js";
import { buildRelationWeb } from "../src/relation-web.js";

const documents: Record<string, string> = {
  "docs/decisions/0001-base.md":
    "# ADR-0001: Base\n\nStatus: `accepted`\nAmended by: [ADR-0003](0003-amend.md)\n",
  "docs/decisions/0002-split.md":
    "# ADR-0002: Split\n\nStatus: `accepted`\n\n## Decision\n\nKeep `runCycle`.\n",
  "docs/decisions/0003-amend.md":
    "# ADR-0003: Amend\n\nStatus: `accepted`\nAmends: [ADR-0001](0001-base.md), [ADR-0002](0002-split.md)\nSupersedes in part: [ADR-0004](0004-part.md) in the named part: Retry\n",
  "docs/decisions/0004-part.md": "# ADR-0004: Part\n\nStatus: `accepted`\n",
  "docs/decisions/0005-new.md":
    "# ADR-0005: New\n\nStatus: `accepted`\nSupersedes: [ADR-0006](0006-old.md)\n",
  "docs/decisions/0006-old.md": "# ADR-0006: Old\n\nStatus: `accepted`\n",
  "docs/guide.md": [
    "# Guide",
    "",
    "The loop calls `runCycle(state)` in `src/loop.ts`; see [ADR-0005](decisions/0005-new.md).",
    "",
    "```ts",
    "const result = admitFinding(candidate);",
    "```",
    "",
    "```bash",
    "lervo knowledge lint --json",
    "```",
  ].join("\n"),
};

function web() {
  return buildRelationWeb({
    documents: Object.entries(documents).map(([path, content]) => ({
      path,
      content,
      role: "canonical_documents",
    })),
    trackedFiles: [...Object.keys(documents), "src/loop.ts"],
    packages: [],
    commands: [],
    lineage: [],
    archiveScopes: ["docs/archive"],
    observedRevision: "rev",
  }).web;
}

function evidence(input: Partial<RelationSuspectEvidence>): RelationSuspectEvidence {
  return {
    reason: "path_changed",
    target: "path:src/loop.ts",
    edgeKind: "names_path",
    line: 3,
    strength: "strong",
    ...input,
  };
}

describe("document lifecycle resolution", () => {
  it("collects code names, not paths, commands, shell fences, or common words", () => {
    const names = documentNamedIdentifiers(documents["docs/guide.md"]!);
    expect([...names].sort()).toEqual(["admitFinding", "candidate", "result", "runCycle", "state"]);
    expect(namesTouchedByChange(names, ["-  runCycle(old);", "+  runCycle(next);"])).toEqual([
      "runCycle",
    ]);
    expect(namesTouchedByChange(names, ["+// lervo knowledge loop.ts json"])).toEqual([]);
  });

  it("settles a changed path whose changed lines name nothing the document names", () => {
    const relation = web();
    const document = relation.documents.get("docs/guide.md")!;
    const resolve = (lines: readonly string[] | null) =>
      resolveLifecycleReason({
        web: relation,
        document,
        evidence: evidence({}),
        content: documents["docs/guide.md"]!,
        changedLines: () => lines,
      });
    expect(resolve(["+const unrelated = 1;"])?.resolution).toBe("deterministic");
    expect(resolve(["-export function runCycle() {}"])).toMatchObject({
      resolution: "provider",
      matchedNames: ["runCycle"],
    });
    // A binary or unreadable diff leaves the reason to the provider.
    expect(resolve(null)?.resolution).toBe("provider");
  });

  it("settles amendments and lineage moves, and supersession the document already follows", () => {
    const relation = web();
    const document = relation.documents.get("docs/guide.md")!;
    const resolve = (input: Partial<RelationSuspectEvidence>) =>
      resolveLifecycleReason({
        web: relation,
        document,
        evidence: evidence(input),
        content: documents["docs/guide.md"]!,
        changedLines: () => [],
      })?.resolution;
    expect(resolve({ reason: "target_amended", via: "docs/decisions/0003-amend.md" })).toBe(
      "deterministic",
    );
    expect(resolve({ reason: "moved_target", via: "docs/spec.md" })).toBe("deterministic");
    expect(resolve({ reason: "target_superseded", via: "docs/decisions/0005-new.md" })).toBe(
      "deterministic",
    );
    expect(resolve({ reason: "target_superseded", via: "docs/decisions/0003-amend.md" })).toBe(
      "provider",
    );
    // Missing reverse header lines are computed from the web, not from one change.
    expect(resolve({ reason: "amended" })).toBeUndefined();
  });

  it("settles a removal only when every line naming it records the removal", () => {
    expect(documentRecordsRemoval("Run `lervo loop run` (removed).\n", "lervo loop run")).toBe(
      true,
    );
    expect(
      documentRecordsRemoval(
        "Run `lervo loop run` (removed).\nThen `lervo loop run` again.\n",
        "lervo loop run",
      ),
    ).toBe(false);
    expect(documentRecordsRemoval("Nothing here.\n", "lervo loop run")).toBe(false);
    const relation = web();
    const resolved = resolveLifecycleReason({
      web: relation,
      document: relation.documents.get("docs/guide.md")!,
      evidence: evidence({ reason: "command_removed", target: "command:lervo loop run" }),
      content: "ADR-0560 removed `lervo loop run`.\n",
      changedLines: () => [],
    });
    expect(resolved?.resolution).toBe("deterministic");
  });

  it("reports reverse header lines a current declaration requires as mechanical edits", () => {
    const relation = web();
    const missing = (path: string) =>
      missingReverseHeaders(relation, relation.documents.get(path)!).map(
        (item) => `${item.reason} ${item.target} ${item.resolution}`,
      );
    // ADR-0001 links back with `Amended by`; ADR-0002 does not.
    expect(missing("docs/decisions/0001-base.md")).toEqual([]);
    expect(missing("docs/decisions/0002-split.md")).toEqual([
      "amended path:docs/decisions/0003-amend.md mechanical",
    ]);
    expect(missing("docs/decisions/0004-part.md")).toEqual([
      "superseded_in_part path:docs/decisions/0003-amend.md mechanical",
    ]);
    expect(missing("docs/decisions/0006-old.md")).toEqual([
      "superseded_undeclared path:docs/decisions/0005-new.md mechanical",
    ]);
  });
});
