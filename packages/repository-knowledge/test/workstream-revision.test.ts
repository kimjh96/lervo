import type { WorkstreamSnapshot } from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { applyJsonMergePatch, deriveWorkstreamRevision } from "../src/workstream-revision.js";

const current: WorkstreamSnapshot = {
  schemaVersion: 1,
  workstreamId: "wks_0123456789abcdef01234567",
  revision: 7,
  status: "active",
  title: "Revision fixture",
  objective: "Exercise server-owned bookkeeping.",
  nextActions: ["First action.", "Second action."],
  blockers: [],
  notes: Array.from({ length: 30 }, (_, index) => `note ${index}`),
  references: [{ path: "docs/a.md", label: "A" }],
  origin: {
    kind: "created",
    sourceArtifactId: null,
    sourceContentHash: null,
    sourcePathDigest: null,
  },
  updatedAt: "2026-10-02T00:00:00.000Z",
};

const bookkeeping = {
  recordedAt: "2026-10-05T12:00:00.000Z",
  repositoryHead: { commit: "a".repeat(40), observedAt: "2026-10-05T12:00:00.000Z" },
};

describe("workstream revision derivation", () => {
  it("implements RFC 7386 merge semantics", () => {
    expect(
      applyJsonMergePatch(
        { a: "b", c: { d: "e", f: "g" }, list: [1, 2] },
        { a: "z", c: { f: null }, list: [3] },
      ),
    ).toEqual({ a: "z", c: { d: "e" }, list: [3] });
    expect(applyJsonMergePatch({ a: 1 }, ["replace"])).toEqual(["replace"]);
  });

  it("stamps revision, update time, and HEAD on the server and ignores caller stamps", () => {
    const derived = deriveWorkstreamRevision({
      current,
      change: {
        kind: "patch",
        value: { nextActions: ["Only action."], updatedAt: "2020-01-01T00:00:00.000Z" },
      },
      bookkeeping,
    });
    expect(derived.blockers).toEqual([]);
    expect(derived.snapshot).toMatchObject({
      revision: 8,
      updatedAt: bookkeeping.recordedAt,
      repositoryHead: bookkeeping.repositoryHead,
      nextActions: ["Only action."],
      references: current.references,
      workstreamId: current.workstreamId,
      origin: current.origin,
    });
    expect(validateSchema("workstreamSnapshot", derived.snapshot).valid).toBe(true);
  });

  it("accepts a full snapshot without bookkeeping fields and carries identity", () => {
    const {
      schemaVersion: _schema,
      workstreamId: _id,
      origin: _origin,
      revision: _revision,
      updatedAt: _at,
      ...semantic
    } = current;
    const derived = deriveWorkstreamRevision({
      current,
      change: { kind: "snapshot", value: { ...semantic, status: "completed" } },
      bookkeeping: { ...bookkeeping, repositoryHead: null },
    });
    expect(derived.blockers).toEqual([]);
    expect(derived.snapshot).toMatchObject({
      schemaVersion: 1,
      workstreamId: current.workstreamId,
      revision: 8,
      status: "completed",
      updatedAt: bookkeeping.recordedAt,
    });
    expect(derived.snapshot).not.toHaveProperty("repositoryHead");
  });

  it("rejects a stale revision assertion and identity or origin rewrites", () => {
    const codes = (value: unknown) =>
      deriveWorkstreamRevision({
        current,
        change: { kind: "patch", value },
        bookkeeping,
      }).blockers.map((blocker) => blocker.code);
    expect(codes({ revision: 8 })).toEqual([]);
    expect(codes({ revision: 7 })).toEqual(["invalid_revision"]);
    expect(codes({ workstreamId: "wks_ffffffffffffffffffffffff" })).toEqual(["identity_changed"]);
    expect(codes({ origin: { kind: "successor" } })).toEqual(["origin_changed"]);
    expect(codes("not an object")).toEqual(["invalid_patch"]);
    expect(codes({ appendNotes: [1] })).toEqual(["invalid_patch"]);
  });

  it("appends notes and keeps the newest 32 while recording the dropped count", () => {
    const first = deriveWorkstreamRevision({
      current,
      change: {
        kind: "patch",
        value: { appendNotes: ["new 1", "new 2", "new 3", "new 4", "new 5"] },
      },
      bookkeeping,
    });
    const notes = first.snapshot?.notes as string[];
    expect(notes).toHaveLength(32);
    expect(notes[0]).toBe("note 3");
    expect(notes.at(-1)).toBe("new 5");
    expect(first.droppedNotesThisRevision).toBe(3);
    expect(first.snapshot?.droppedNoteCount).toBe(3);
    const second = deriveWorkstreamRevision({
      current: first.snapshot as WorkstreamSnapshot,
      change: { kind: "patch", value: { appendNotes: ["newer"], droppedNoteCount: 0 } },
      bookkeeping,
    });
    expect(second.droppedNotesThisRevision).toBe(1);
    expect(second.snapshot?.droppedNoteCount).toBe(4);
  });
});
