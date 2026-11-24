import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildRelationWeb,
  governingDocumentsFor,
  governingIndexFromRelationWeb,
} from "@lervo/repository-knowledge";

import {
  markTurnGovernanceShown,
  readTurnGovernance,
  recordTurnGovernance,
  turnGovernanceLine,
  turnGovernanceSummary,
  writeGoverningIndex,
} from "../src/turn-governance.js";

function webOf(documents: { path: string; content: string; role: string }[]) {
  return buildRelationWeb({
    documents,
    trackedFiles: [...documents.map((document) => document.path), "apps/cli/src/upgrade.ts"],
    packages: [],
    commands: [],
    lineage: [],
    archiveScopes: [],
    observedRevision: null,
  }).web;
}

const index = governingIndexFromRelationWeb(
  webOf([
    {
      path: "docs/decisions/0001-upgrade.md",
      content: "# Upgrade\n\nThe policy lives in `apps/cli/src/upgrade.ts`.\n",
      role: "canonical_documents",
    },
    {
      path: "docs/specifications/cli.md",
      content: "# CLI\n\nEverything under `apps/cli/`.\n",
      role: "canonical_documents",
    },
    {
      path: "docs/decisions/0000-old.md",
      content: "---\nstatus: superseded\n---\n# Old\n\n`apps/cli/src/upgrade.ts`\n",
      role: "canonical_documents",
    },
    { path: "docs/evidence/run.md", content: "`apps/cli/src/upgrade.ts`\n", role: "evidence" },
    {
      path: "docs/roadmap/plan.md",
      content: "Delivered in `apps/cli/src/upgrade.ts`.\n",
      role: "canonical_documents",
    },
  ]),
);

describe("governing index", () => {
  it("maps named files and directories to current canonical documents", () => {
    expect(governingDocumentsFor(index, "apps/cli/src/upgrade.ts")).toEqual([
      "docs/decisions/0001-upgrade.md",
      "docs/specifications/cli.md",
    ]);
    expect(governingDocumentsFor(index, "apps/cli/src/other.ts")).toEqual([
      "docs/specifications/cli.md",
    ]);
    expect(governingDocumentsFor(index, "packages/x/src/a.ts")).toEqual([]);
  });

  it("keeps a weak mention from hiding a later strong one of the same path", () => {
    const later = governingIndexFromRelationWeb(
      webOf([
        {
          path: "docs/decisions/0002-later.md",
          content: "The CLI lives in `apps/cli`.\n\nEverything under `apps/cli/` follows it.\n",
          role: "canonical_documents",
        },
      ]),
    );
    // `apps/cli` alone is a weak mention; the later `apps/cli/` is strong and must win.
    expect(governingDocumentsFor(later, "apps/cli/src/upgrade.ts")).toEqual([
      "docs/decisions/0002-later.md",
    ]);
  });
});

describe("governing index bound", () => {
  it("marks a document past the reference bound as truncated", () => {
    // References are bounded in document order, so a code path after 600 links is not recorded;
    // the truncated mark records that the document may govern more than the index lists.
    const links = Array.from({ length: 600 }, (_, item) => `[d${item}](d${item}.md)`).join(" ");
    const big = governingIndexFromRelationWeb(
      webOf([
        {
          path: "docs/decisions/0009-big.md",
          content: `${links}\n\n\`src/late.ts\`\n`,
          role: "canonical_documents",
        },
      ]),
    );
    expect(big.truncated).toEqual(["docs/decisions/0009-big.md"]);
  });
});

describe("turn governance", () => {
  it("records misses, shows them once, and summarizes the miss rate", async () => {
    const root = await mkdtemp(join(tmpdir(), "lervo-governance-"));
    // Without an index nothing is recorded, so absence never reads as zero misses.
    await recordTurnGovernance({
      root,
      turnKey: "evt_zero",
      changedPaths: ["apps/cli/src/upgrade.ts"],
      selectedPaths: [],
      at: "2026-11-01T00:00:00.000Z",
    });
    expect(await readTurnGovernance(root)).toBeNull();

    await writeGoverningIndex(root, index);
    await recordTurnGovernance({
      root,
      turnKey: "evt_one",
      changedPaths: ["apps/cli/src/upgrade.ts", "docs/specifications/cli.md"],
      selectedPaths: [],
      at: "2026-11-01T01:00:00.000Z",
    });
    const missed = await readTurnGovernance(root);
    expect(missed!.pending).toMatchObject({
      changed: ["apps/cli/src/upgrade.ts"],
      missed: ["docs/decisions/0001-upgrade.md"],
      shownAt: null,
    });
    expect(turnGovernanceLine(missed)).toContain(
      "changed apps/cli/src/upgrade.ts without consulting the canon that names it: docs/decisions/0001-upgrade.md",
    );
    // A retried Stop for the same turn records nothing new.
    await recordTurnGovernance({
      root,
      turnKey: "evt_one",
      changedPaths: ["apps/cli/src/upgrade.ts"],
      selectedPaths: [],
      at: "2026-11-01T01:01:00.000Z",
    });
    expect((await readTurnGovernance(root))!.turns).toHaveLength(1);
    // Marking an older pending check leaves the current one pending.
    await markTurnGovernanceShown(root, "2026-10-31T00:00:00.000Z", "2026-11-01T01:05:00.000Z");
    expect(turnGovernanceLine(await readTurnGovernance(root))).not.toBeNull();
    await markTurnGovernanceShown(root, "2026-11-01T01:00:00.000Z", "2026-11-01T01:05:00.000Z");
    expect(turnGovernanceLine(await readTurnGovernance(root))).toBeNull();

    await recordTurnGovernance({
      root,
      turnKey: "evt_two",
      changedPaths: ["apps/cli/src/upgrade.ts"],
      selectedPaths: ["docs/decisions/0001-upgrade.md", "docs/specifications/cli.md"],
      at: "2026-11-01T02:00:00.000Z",
    });
    const consulted = await readTurnGovernance(root);
    expect(consulted!.pending).toBeNull();
    expect(turnGovernanceSummary(consulted, new Date("2026-11-01T03:00:00.000Z"))).toEqual({
      governedTurnCount: 2,
      missedTurnCount: 1,
    });
    expect(turnGovernanceSummary(consulted, new Date("2026-11-09T03:00:00.000Z"))).toEqual({
      governedTurnCount: 0,
      missedTurnCount: 0,
    });
  });
});
