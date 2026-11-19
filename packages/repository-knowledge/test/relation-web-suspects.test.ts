import { describe, expect, it } from "vitest";

import { extractRelationDocument } from "../src/relation-web-extraction.js";
import { buildRelationWeb } from "../src/relation-web.js";
import { relationSuspectsFor, type RelationSuspectSet } from "../src/relation-web-suspects.js";

const trackedFiles = [
  "packages/slack/package.json",
  "packages/slack/src/send.ts",
  "packages/core/src/a.ts",
  "packages/core/src/b.ts",
  "packages/core/README.md",
  "docs/old-spec.md",
  "docs/decisions/0001-base.md",
  "docs/decisions/0002-loop.md",
  "docs/decisions/0003-remove.md",
  "docs/decisions/0004-later.md",
];

const documents: Record<string, string> = {
  "docs/decisions/0001-base.md": "# ADR-0001: Base\n\nStatus: `accepted`\n",
  "docs/decisions/0002-loop.md":
    "# ADR-0002: Loop\n\nStatus: `accepted`\n\n## Decision\n\nRun `lervo loop run` from `packages/slack/`.\n",
  "docs/decisions/0004-later.md":
    "# ADR-0004: Later\n\nStatus: `accepted`\n\n## Decision\n\nBuilds on [ADR-0002](0002-loop.md) and ADR-0001.\n",
  "docs/guide.md": [
    "# Guide",
    "",
    "Send with `packages/slack/src/send.ts` from @lervo/slack.",
    "Core lives in `packages/core/src/`; see `packages/core/src/a.ts` and `packages`.",
    "Read [the spec](old-spec.md). Use `lervo loop status` or `lervo knowledge query`.",
  ].join("\n"),
  "docs/archive/old.md": "# Old\n\nUses `packages/slack/src/send.ts`.\n",
  "docs/history.md": "# History\n\nStatus: `historical`\n\nUses @lervo/slack.\n",
};

function web(extra: Record<string, string> = {}) {
  return buildRelationWeb({
    documents: Object.entries({ ...documents, ...extra }).map(([path, content]) => ({
      path,
      content,
      role: "canonical_documents",
    })),
    trackedFiles: [...trackedFiles, ...Object.keys(extra)],
    packages: [
      { name: "@lervo/slack", directory: "packages/slack" },
      { name: "@lervo/core", directory: "packages/core" },
    ],
    commands: ["lervo loop run", "lervo loop status", "lervo knowledge query"],
    lineage: [{ kind: "moved_to", from: "docs/old-spec.md", to: "docs/spec.md", record: "r.yaml" }],
    archiveScopes: ["docs/archive"],
    observedRevision: "rev",
  }).web;
}

function summary(result: RelationSuspectSet): Record<string, string[]> {
  return Object.fromEntries(
    result.suspects.map((suspect) => [
      suspect.document,
      suspect.reasons.map(
        (reason) =>
          `${reason.reason} ${reason.target}${reason.via === undefined ? "" : ` via ${reason.via}`} @${reason.line}`,
      ),
    ]),
  );
}

describe("relation web suspects", () => {
  it("maps a removed package, its directory, its commands, and a moved document", () => {
    const result = relationSuspectsFor(web(), {
      changedPaths: [],
      deletedPaths: [
        "packages/slack/package.json",
        "packages/slack/src/send.ts",
        "docs/old-spec.md",
      ],
      removedCommands: ["lervo loop run", "lervo loop status"],
    });
    expect(result.removedDirectories).toEqual(["packages/slack", "packages/slack/src"]);
    expect(result.removedPackages).toEqual(["@lervo/slack"]);
    expect(result.removedCommandGroups).toEqual(["lervo loop"]);
    expect(summary(result)).toEqual({
      "docs/decisions/0002-loop.md": [
        "command_removed command:lervo loop run @7",
        "path_removed path:packages/slack @7",
      ],
      "docs/guide.md": [
        "command_removed command:lervo loop status @5",
        "moved_target path:docs/old-spec.md via docs/spec.md @5",
        "package_removed package:@lervo/slack via packages/slack @3",
        "path_removed path:packages/slack/src/send.ts @3",
      ],
    });
  });

  it("reports a changed code path and its named directory but not a top-level directory", () => {
    const result = relationSuspectsFor(web(), {
      changedPaths: ["packages/core/src/a.ts", "packages/core/README.md"],
      deletedPaths: [],
    });
    expect(summary(result)).toEqual({
      "docs/guide.md": [
        "path_changed path:packages/core/src via packages/core/src/a.ts @4",
        "path_changed path:packages/core/src/a.ts @4",
      ],
    });
  });

  it("reaches a document through a named directory only when the document is about it", () => {
    const overview = [
      "# Overview",
      "",
      "Decisions live in `packages/core/src/`. Sending is `packages/slack/src/send.ts`,",
      "packaging is `packages/slack/package.json`, and the readme is `packages/core/README.md`.",
    ].join("\n");
    const result = relationSuspectsFor(web({ "docs/overview.md": overview }), {
      changedPaths: ["packages/core/src/b.ts"],
      deletedPaths: [],
    });
    // The guide names `packages/core/src/` and `a.ts` below it: two of its three code paths.
    expect(summary(result)).toEqual({
      "docs/guide.md": ["path_changed path:packages/core/src via packages/core/src/b.ts @4"],
    });
    // A removed directory still reaches every document that names it.
    const removed = relationSuspectsFor(web({ "docs/overview.md": overview }), {
      changedPaths: [],
      deletedPaths: ["packages/core/src/a.ts", "packages/core/src/b.ts"],
    });
    expect(summary(removed)["docs/overview.md"]).toEqual([
      "path_removed path:packages/core/src @3",
    ]);
  });

  it("closes over a changed header: superseded, superseded in part, and amended targets", () => {
    const remover = [
      "# ADR-0003: Remove",
      "",
      "Status: `accepted`",
      "Supersedes: [ADR-0002](0002-loop.md)",
      "Supersedes in part: ADR-0004 (later part)",
      "Amends: ADR-0001",
    ].join("\n");
    const result = relationSuspectsFor(web({ "docs/decisions/0003-remove.md": remover }), {
      changedPaths: ["docs/decisions/0003-remove.md"],
      deletedPaths: [],
    });
    expect(result.superseded).toEqual([
      {
        document: "docs/decisions/0002-loop.md",
        by: "docs/decisions/0003-remove.md",
        line: 4,
      },
    ]);
    expect(summary(result)).toEqual({
      "docs/decisions/0001-base.md": [
        "amended path:docs/decisions/0003-remove.md via docs/decisions/0003-remove.md @0",
      ],
      "docs/decisions/0004-later.md": [
        "superseded_in_part path:docs/decisions/0003-remove.md via docs/decisions/0003-remove.md @0",
        "target_amended path:docs/decisions/0001-base.md via docs/decisions/0003-remove.md @7",
        "target_superseded path:docs/decisions/0002-loop.md via docs/decisions/0003-remove.md @7",
      ],
    });
    expect(result.suspects[1]!.reasons[0]!.part).toBe("later part");
  });

  it("closes only over header declarations that are new in a changed document", () => {
    const remover = "# ADR-0003: Remove\n\nStatus: `accepted`\nAmends: ADR-0001\n";
    const current = web({
      "docs/decisions/0003-remove.md": `${remover}Supersedes: [ADR-0002](0002-loop.md)\n`,
    });
    const result = relationSuspectsFor(current, {
      changedPaths: ["docs/decisions/0003-remove.md"],
      deletedPaths: [],
      previousExtractions: new Map([
        [
          "docs/decisions/0003-remove.md",
          extractRelationDocument({
            path: "docs/decisions/0003-remove.md",
            content: remover,
            observedRevision: "old",
          }),
        ],
      ]),
    });
    expect(result.superseded.map((item) => item.document)).toEqual(["docs/decisions/0002-loop.md"]);
    expect(summary(result)).toEqual({
      "docs/decisions/0004-later.md": [
        "target_superseded path:docs/decisions/0002-loop.md via docs/decisions/0003-remove.md @7",
      ],
    });
  });

  it("never marks historical or deleted documents", () => {
    const result = relationSuspectsFor(web(), {
      changedPaths: [],
      deletedPaths: ["packages/slack/src/send.ts", "packages/slack/package.json", "docs/guide.md"],
    });
    expect(Object.keys(summary(result))).toEqual(["docs/decisions/0002-loop.md"]);
  });
});
