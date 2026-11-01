import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { buildGoverningIndex, governingDocumentsFor } from "@lervo/repository-knowledge";

import {
  markTurnGovernanceShown,
  readTurnGovernance,
  recordTurnGovernance,
  turnGovernanceLine,
  turnGovernanceSummary,
  writeGoverningIndex,
} from "../src/turn-governance.js";

const index = buildGoverningIndex({
  documents: [
    {
      path: "docs/decisions/0001-upgrade.md",
      content: "# Upgrade\n\nThe policy lives in `apps/cli/src/upgrade.ts`.\n",
    },
    { path: "docs/specifications/cli.md", content: "# CLI\n\nEverything under `apps/cli/`.\n" },
    {
      path: "docs/decisions/0000-old.md",
      content: "---\nstatus: superseded\n---\n# Old\n\n`apps/cli/src/upgrade.ts`\n",
    },
    { path: "docs/evidence/run.md", content: "`apps/cli/src/upgrade.ts`\n" },
  ],
  canonical: (path) =>
    path.startsWith("docs/decisions/") || path.startsWith("docs/specifications/"),
  archiveScopes: [],
});

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
});

describe("governing index bound", () => {
  it("lets excluded Markdown references not displace code paths", () => {
    const links = Array.from({ length: 600 }, (_, index) => `[d${index}](d${index}.md)`).join(" ");
    const big = buildGoverningIndex({
      documents: [{ path: "docs/decisions/0009-big.md", content: `${links}\n\n\`src/late.ts\`\n` }],
      canonical: () => true,
      archiveScopes: [],
    });
    expect(governingDocumentsFor(big, "src/late.ts")).toEqual(["docs/decisions/0009-big.md"]);
    expect(big.truncated).toEqual([]);
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
