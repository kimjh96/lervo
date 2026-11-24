import { expect, it } from "vitest";

import { buildRelationWeb } from "../src/relation-web.js";
import { relationWebSuccessors } from "../src/relation-web-supersession.js";

const documents: Record<string, string> = {
  "docs/decisions/0001-old.md": "# ADR-0001: Old\n\nStatus: `accepted`\n",
  "docs/decisions/0002-new.md":
    "# ADR-0002: New\n\nStatus: `accepted`\nSupersedes: [ADR-0001](0001-old.md)\n",
  "docs/decisions/0003-older.md":
    "# ADR-0003: Older\n\nStatus: superseded by [ADR-0004](0004-newer.md)\n",
  "docs/decisions/0004-newer.md": "# ADR-0004: Newer\n\nStatus: `accepted`\n",
  "docs/decisions/0005-bare.md": "# ADR-0005: Bare\n\nStatus: `accepted`\nSupersedes: ADR-0006\n",
  "docs/decisions/0006-target.md": "# ADR-0006: Target\n\nStatus: `accepted`\n",
  "docs/decisions/0007-part.md":
    "# ADR-0007: Part\n\nStatus: `accepted`\nSupersedes in part: [ADR-0008](0008-whole.md) (Retry)\n",
  "docs/decisions/0008-whole.md":
    "# ADR-0008: Whole\n\nStatus: `accepted`\nSuperseded in part by: [ADR-0007](0007-part.md) (Retry)\n",
  "docs/decisions/0009-replaced.md":
    "# ADR-0009: Replaced\n\nStatus: `accepted`\nSuperseded by: [ADR-0010](0010-successor.md)\n",
  "docs/decisions/0010-successor.md": "# ADR-0010: Successor\n\nStatus: `accepted`\n",
  "docs/decisions/0011-remove.md":
    "# ADR-0011: Remove\n\nStatus: `accepted`\nSupersedes, fully or in the named part:\n\n- Old tools: [ADR-0012](0012-full.md); in the named part: [ADR-0013](0013-split.md) (Retry)\n",
  "docs/decisions/0012-full.md": "# ADR-0012: Full\n\nStatus: `accepted`\n",
  "docs/decisions/0013-split.md": "# ADR-0013: Split\n\nStatus: `accepted`\n",
  "docs/decisions/0014-ambiguous.md":
    "# ADR-0014: Ambiguous\n\nStatus: `accepted`\nSupersedes: ADR-0015\n",
  "docs/decisions/0015-one.md": "# ADR-0015: One\n\nStatus: `accepted`\n",
  "docs/decisions/sync/0015-two.md": "# ADR-0015: Two\n\nStatus: `accepted`\n",
  "docs/guide.md":
    "# Guide\n\nThe new layout supersedes [the old guide](old-guide.md) in practice.\n",
  "docs/old-guide.md": "# Old guide\n",
};

it("maps full supersessions from header relations only (ADR-0562)", () => {
  const web = buildRelationWeb({
    documents: Object.entries(documents).map(([path, content]) => ({
      path,
      content,
      role: "canonical_documents",
    })),
    trackedFiles: Object.keys(documents),
    packages: [],
    commands: [],
    lineage: [],
    archiveScopes: [],
    observedRevision: "rev",
  }).web;
  expect(Object.fromEntries(relationWebSuccessors(web))).toEqual({
    "docs/decisions/0001-old.md": "docs/decisions/0002-new.md",
    "docs/decisions/0003-older.md": "docs/decisions/0004-newer.md",
    // A bare ADR number resolves to its document.
    "docs/decisions/0006-target.md": "docs/decisions/0005-bare.md",
    // An incoming `Superseded by` line points the same way.
    "docs/decisions/0009-replaced.md": "docs/decisions/0010-successor.md",
    // In a full-or-named-part list, only the full targets count.
    "docs/decisions/0012-full.md": "docs/decisions/0011-remove.md",
    // A superseded part, an ADR number two documents carry, and prose that says "supersedes"
    // are no full supersession.
  });
});
