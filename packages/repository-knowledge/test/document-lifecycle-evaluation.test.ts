import { describe, expect, it } from "vitest";

import type { DocumentFreshnessAssessmentV1 } from "../src/document-freshness-assessment.js";
import { evaluateDocumentLifecycle } from "../src/document-lifecycle-evaluation.js";
import type { DocumentLifecycleGitPort } from "../src/document-lifecycle-git.js";
import {
  emptyDocumentLifecycleRecord,
  MAXIMUM_LIFECYCLE_RECORD_DOCUMENTS,
} from "../src/document-lifecycle-record.js";
import { relationContentHash } from "../src/relation-web-extraction.js";
import { buildRelationWeb } from "../src/relation-web.js";

const BEFORE = "1".repeat(40);
const HEAD = "2".repeat(40);
const NOW = new Date("2026-11-19T06:00:00.000Z");

const guide = [
  "# Guide",
  "",
  "The loop calls `runCycle(state)` in `src/loop.ts`.",
  "",
  "```ts",
  "const result = admitFinding(candidate);",
  "```",
].join("\n");

function prose(index: number): string {
  return `# Note ${index}\n\nA short note with no code names.\n`;
}

function documents(notes: number): Record<string, string> {
  const result: Record<string, string> = {
    "docs/guide.md": guide,
    "docs/archive/old.md": "# Old\n\nThe old loop in `src/loop.ts`.\n",
  };
  for (let index = 0; index < notes; index += 1)
    result[`docs/notes/${String(index).padStart(2, "0")}.md`] = prose(index);
  return result;
}

function web(contents: Record<string, string>) {
  return buildRelationWeb({
    documents: Object.entries(contents).map(([path, content]) => ({
      path,
      content,
      role: "canonical_documents",
    })),
    trackedFiles: [...Object.keys(contents), "src/loop.ts"],
    packages: [],
    commands: [],
    lineage: [],
    archiveScopes: ["docs/archive"],
    observedRevision: HEAD,
  }).web;
}

/** A fake read-only Git port: every document was last committed at BEFORE; HEAD changed one file. */
function git(
  input: {
    changedLines?: string[];
    changesFail?: boolean;
    objects?: Record<string, string>;
  } = {},
): DocumentLifecycleGitPort & { diffs: string[] } {
  const diffs: string[] = [];
  return {
    diffs,
    headRevision: () => Promise.resolve(HEAD),
    // Every path was last committed at BEFORE.
    latestPathRevisions: () =>
      Promise.resolve({
        get: () => ({ revision: BEFORE, committedAt: "2026-11-01T00:00:00.000Z", order: 1 }),
      } as unknown as Map<string, { revision: string; committedAt: string; order: number }>),
    objectNames: (lookups) =>
      Promise.resolve(
        new Map(lookups.map((lookup) => [lookup, input.objects?.[lookup] ?? null] as const)),
      ),
    changes: (from, to) => {
      diffs.push(`${from}..${to}`);
      return input.changesFail === true
        ? Promise.reject(new Error("bad revision"))
        : Promise.resolve({ changedPaths: ["src/loop.ts"], deletedPaths: [] });
    },
    blobs: (lookups) => Promise.resolve(new Map(lookups.map((lookup) => [lookup, null] as const))),
    changedLines: () =>
      Promise.resolve(new Map([["src/loop.ts", input.changedLines ?? ["const unrelated = 1;"]]])),
  };
}

function evaluate(
  contents: Record<string, string>,
  port: DocumentLifecycleGitPort,
  record = emptyDocumentLifecycleRecord(),
  assessments: DocumentFreshnessAssessmentV1[] = [],
  now = NOW,
  budget?: { maximumGroups: number },
) {
  return evaluateDocumentLifecycle({
    web: web(contents),
    record,
    git: port,
    now,
    readDocument: (path) => Promise.resolve(contents[path] ?? null),
    assessments,
    ...(budget === undefined ? {} : { budget }),
  });
}

describe("document lifecycle evaluation (ADR-0562)", () => {
  it("sweeps at most the daily cadence, documents that name code first", async () => {
    const contents = documents(20);
    const evaluation = await evaluate(contents, git());
    // 22 documents, one historical: 21 current candidates, 16 swept on the first day.
    expect(evaluation.summary.cadence).toMatchObject({
      perDay: 16,
      assessedToday: 16,
      unassessed: 5,
      remainingDays: 1,
    });
    expect(evaluation.entries.get("docs/guide.md")?.state).toBe("current");
    expect(evaluation.entries.get("docs/archive/old.md")?.state).toBe("archived");
    const waiting = [...evaluation.entries.values()].filter((entry) =>
      entry.reasons.some((reason) => reason.reason === "cadence_due"),
    );
    expect(waiting.map((entry) => entry.path)).toEqual([
      "docs/notes/15.md",
      "docs/notes/16.md",
      "docs/notes/17.md",
      "docs/notes/18.md",
      "docs/notes/19.md",
    ]);
    expect(evaluation.record.cadence).toEqual({ day: "2026-11-19", assessed: 16 });

    // The same day sweeps nothing more; the next day continues where it stopped.
    const sameDay = await evaluate(contents, git(), evaluation.record);
    expect(sameDay.summary.cadence).toMatchObject({ assessedToday: 16, unassessed: 5 });
    const nextDay = await evaluate(
      contents,
      git(),
      evaluation.record,
      [],
      new Date("2026-11-20T06:00:00.000Z"),
    );
    expect(nextDay.summary.cadence).toMatchObject({ assessedToday: 5, unassessed: 0 });
    expect(nextDay.entries.get("docs/notes/19.md")?.state).toBe("current");
  });

  it("settles a change that touched nothing the document names, at HEAD, without a provider", async () => {
    const evaluation = await evaluate(documents(0), git({ changedLines: ["const other = 2;"] }));
    const entry = evaluation.entries.get("docs/guide.md")!;
    expect(entry).toMatchObject({ state: "current", reasons: [], assessedRevision: HEAD });
    expect(evaluation.record.documents["docs/guide.md"]).toMatchObject({
      assessedRevision: HEAD,
      contentHash: relationContentHash(guide),
    });
    expect(evaluation.record.documents["docs/guide.md"]?.reasons).toBeUndefined();
    expect(evaluation.summary.resolution).toEqual({ deterministic: 1, mechanical: 0, provider: 0 });
  });

  it("leaves a change that touched a named identifier to the provider, at its baseline", async () => {
    const contents = documents(0);
    const port = git({ changedLines: ["export function runCycle(state) {"] });
    const evaluation = await evaluate(contents, port);
    const entry = evaluation.entries.get("docs/guide.md")!;
    expect(entry.state).toBe("suspect");
    expect(entry.assessedRevision).toBe(BEFORE);
    expect(entry.reasons).toEqual([
      expect.objectContaining({
        reason: "path_changed",
        resolution: "provider",
        matchedNames: ["runCycle", "state"],
      }),
    ]);
    expect(evaluation.record.documents["docs/guide.md"]).toMatchObject({
      assessedRevision: BEFORE,
      reasons: [expect.objectContaining({ reason: "path_changed" })],
    });
    expect(evaluation.summary.suspects).toEqual({
      mechanical: 0,
      provider: 1,
      cadence: 0,
      unknown: 0,
    });

    // At the recorded HEAD no new change reaches it: the open reason is reused without a diff.
    const reusing = git({ changedLines: ["export function runCycle(state) {"] });
    const again = await evaluate(contents, reusing, evaluation.record);
    expect(reusing.diffs).toEqual([]);
    expect(again.entries.get("docs/guide.md")).toMatchObject({
      state: "suspect",
      assessedRevision: BEFORE,
    });
  });

  it("marks a document refreshed when a provider no-change assessment still matches HEAD", async () => {
    const contents = documents(0);
    const assessment = {
      schemaVersion: 1,
      documentPath: "docs/guide.md",
      documentHash: relationContentHash(guide),
      assessedRevision: HEAD,
      outcome: "verified_no_change",
      dependency: { objects: [{ path: "src/loop.ts", objectName: "a".repeat(40) }] },
    } as unknown as DocumentFreshnessAssessmentV1;
    const evaluation = await evaluate(
      contents,
      git({
        changedLines: ["export function runCycle(state) {"],
        objects: { [`${HEAD}:src/loop.ts`]: "a".repeat(40) },
      }),
      emptyDocumentLifecycleRecord(),
      [assessment],
    );
    expect(evaluation.entries.get("docs/guide.md")).toMatchObject({
      state: "refreshed",
      reasons: [],
      verifiedRevision: HEAD,
    });
  });

  it("keeps an unavailable baseline suspect and unknown, and drops it from the record", async () => {
    const contents = documents(0);
    const evaluation = await evaluate(contents, git({ changesFail: true }));
    expect(evaluation.unavailable.has("docs/guide.md")).toBe(true);
    expect(evaluation.entries.get("docs/guide.md")?.state).toBe("suspect");
    expect(evaluation.summary.suspects.unknown).toBe(1);
    expect(evaluation.record.documents["docs/guide.md"]).toBeUndefined();
  });

  it("defers what does not fit one call's budget, without counting it as swept", async () => {
    const contents = documents(3);
    const port = git();
    const evaluation = await evaluate(contents, port, emptyDocumentLifecycleRecord(), [], NOW, {
      maximumGroups: 0,
    });
    expect(port.diffs).toEqual([]);
    expect([...evaluation.deferred].sort()).toEqual([
      "docs/guide.md",
      "docs/notes/00.md",
      "docs/notes/01.md",
      "docs/notes/02.md",
    ]);
    expect(evaluation.entries.get("docs/guide.md")).toMatchObject({
      state: "suspect",
      reasons: [expect.objectContaining({ reason: "cadence_due" })],
    });
    expect(evaluation.summary.cadence).toMatchObject({ assessedToday: 0, unassessed: 4 });
    expect(evaluation.record.documents).toEqual({});
    expect(evaluation.record.cadence.assessed).toBe(0);

    // A deferred recorded document keeps its assessment as it was.
    const recorded = await evaluate(contents, git({ changedLines: ["runCycle(state);"] }));
    const changed = git({ changedLines: ["runCycle(state);"] });
    const later = await evaluate(
      contents,
      changed,
      { ...recorded.record, revision: BEFORE },
      [],
      NOW,
      { maximumGroups: 0 },
    );
    expect(later.deferred.has("docs/guide.md")).toBe(true);
    expect(later.record.documents["docs/guide.md"]).toEqual(
      recorded.record.documents["docs/guide.md"],
    );
  });

  it("sweeps and records only the documents the record can hold", async () => {
    const contents: Record<string, string> = { "docs/guide.md": guide };
    for (let index = 0; index < MAXIMUM_LIFECYCLE_RECORD_DOCUMENTS + 4; index += 1)
      contents[`docs/n/${String(index).padStart(4, "0")}.md`] = prose(index);
    const evaluation = await evaluate(contents, git());
    const unrecordable = ["docs/n/4096.md", "docs/n/4097.md", "docs/n/4098.md", "docs/n/4099.md"];
    // The record holds the first documents by path, so the last notes never count as swept.
    expect(unrecordable.map((path) => evaluation.entries.get(path)?.state)).toEqual(
      unrecordable.map(() => "suspect"),
    );
    expect(Object.keys(evaluation.record.documents)).toHaveLength(
      evaluation.summary.cadence.perDay,
    );
    expect(unrecordable.some((path) => path in evaluation.record.documents)).toBe(false);
    const total = MAXIMUM_LIFECYCLE_RECORD_DOCUMENTS + 5;
    expect(evaluation.summary.cadence).toMatchObject({
      perDay: Math.ceil(total / 14),
      unassessed: total - Math.ceil(total / 14),
    });
  });
});
