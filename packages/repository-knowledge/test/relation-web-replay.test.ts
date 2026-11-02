import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildRelationWeb } from "../src/relation-web.js";
import { relationSuspectsFor } from "../src/relation-web-suspects.js";

/**
 * ADR-0562 acceptance replay. The fixture records the documents on origin/main before the ADR-0560
 * removal that still name a removed package, command, or path, found by an oracle independent of
 * the web (`scripts/evaluation/generate-relation-web-replay-fixture.mjs`) and reviewed line by
 * line. The documents themselves are read from Git history, which CI checks out in full.
 */
interface ReplayFixture {
  revisions: { before: string; after: string };
  supersedingDocument: string;
  commands: { before: string[]; after: string[] };
  removedPackages: string[];
  expected: { document: string; edited: boolean; reasons: string[] }[];
  removalEdited: string[];
}

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const fixture = JSON.parse(
  readFileSync(new URL("fixtures/relation-web-adr-0560-replay.json", import.meta.url), "utf8"),
) as ReplayFixture;

function git(args: string[]): string {
  return execFileSync("git", ["-C", repositoryRoot, "-c", "core.quotePath=false", ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function historyAvailable(): boolean {
  return [fixture.revisions.before, fixture.revisions.after].every(
    (revision) =>
      spawnSync("git", ["-C", repositoryRoot, "cat-file", "-e", `${revision}^{commit}`]).status ===
      0,
  );
}

/** Reads many blobs through one `git cat-file --batch` process. */
function blobs(revision: string, paths: readonly string[]): Map<string, string> {
  const output = execFileSync("git", ["-C", repositoryRoot, "cat-file", "--batch"], {
    input: paths.map((path) => `${revision}:${path}\n`).join(""),
    maxBuffer: 256 * 1024 * 1024,
  });
  const contents = new Map<string, string>();
  let offset = 0;
  for (const path of paths) {
    const headerEnd = output.indexOf(0x0a, offset);
    const header = output.subarray(offset, headerEnd).toString("utf8");
    const size = Number(header.split(" ")[2]);
    if (!Number.isSafeInteger(size)) throw new Error(`missing blob ${path}: ${header}`);
    contents.set(path, output.subarray(headerEnd + 1, headerEnd + 1 + size).toString("utf8"));
    offset = headerEnd + 1 + size + 1;
  }
  return contents;
}

function list(output: string): string[] {
  return output.split("\0").filter((item) => item !== "");
}

describe.skipIf(!historyAvailable())("relation web ADR-0560 acceptance replay", () => {
  it("marks the documents that still describe removed parts as suspect, with reasons", () => {
    const { before, after } = fixture.revisions;
    const files = list(git(["ls-tree", "-r", "-z", "--name-only", before]));
    const markdown = files.filter((path) => /\.mdx?$/iu.test(path) && !path.startsWith(".lervo/"));
    const manifests = files.filter((path) =>
      /^(?:apps|packages)\/[^/]+\/package\.json$/u.test(path),
    );
    const contents = blobs(before, [...markdown, ...manifests]);
    const superseding = blobs(after, [fixture.supersedingDocument]);
    const deleted = list(
      git(["diff", "-z", "--no-renames", "--name-only", "--diff-filter=D", before, after]),
    );

    const { web } = buildRelationWeb({
      documents: [...markdown, fixture.supersedingDocument].map((path) => ({
        path,
        content: contents.get(path) ?? superseding.get(path)!,
        role: "document",
      })),
      trackedFiles: [...files, fixture.supersedingDocument],
      packages: manifests.map((path) => ({
        name: (JSON.parse(contents.get(path)!) as { name: string }).name,
        directory: path.slice(0, -"/package.json".length),
      })),
      commands: fixture.commands.before,
      lineage: [],
      archiveScopes: ["docs/archive"],
      observedRevision: before,
    });
    const afterCommands = new Set(fixture.commands.after);
    const result = relationSuspectsFor(web, {
      changedPaths: [fixture.supersedingDocument],
      deletedPaths: deleted,
      removedCommands: fixture.commands.before.filter((command) => !afterCommands.has(command)),
    });

    expect(result.removedPackages).toEqual(fixture.removedPackages);
    const suspects = new Map(result.suspects.map((suspect) => [suspect.document, suspect]));
    const missed = fixture.expected.filter((item) => !suspects.has(item.document));
    // ADR-0562 acceptance: at least 28 of every 30 documents that still describe removed parts.
    expect(fixture.expected.length - missed.length).toBeGreaterThanOrEqual(
      Math.ceil((fixture.expected.length * 28) / 30),
    );
    expect(missed.map((item) => item.document)).toEqual([]);
    for (const item of fixture.expected)
      expect(
        suspects
          .get(item.document)!
          .reasons.some((reason) =>
            ["path_removed", "package_removed", "command_removed", "moved_target"].includes(
              reason.reason,
            ),
          ),
      ).toBe(true);

    // Precision lower bound: a suspect is confirmed when the oracle lists it or the removal itself
    // edited it. Unconfirmed suspects name a fully superseded decision or are the superseding ADR.
    const confirmed = new Set([
      ...fixture.expected.map((item) => item.document),
      ...fixture.removalEdited,
    ]);
    const unconfirmed = result.suspects.filter((suspect) => !confirmed.has(suspect.document));
    expect(unconfirmed.length / result.suspects.length).toBeLessThanOrEqual(0.1);
    expect(
      unconfirmed.every((suspect) =>
        suspect.reasons.every(
          (reason) =>
            reason.reason === "target_superseded" ||
            suspect.document === fixture.supersedingDocument,
        ),
      ),
    ).toBe(true);
    // Every decision the superseding header supersedes in full was edited by the removal.
    expect(result.superseded.length).toBeGreaterThan(0);
    const edited = new Set(fixture.removalEdited);
    expect(result.superseded.filter((item) => !edited.has(item.document))).toEqual([]);
  });
});
