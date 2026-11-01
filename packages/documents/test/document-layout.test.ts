import { defaultRepositoryDocumentPolicy } from "@lervo/project";
import { describe, expect, it } from "vitest";

import {
  createDocumentLayoutPermit,
  evaluateDocumentLayout,
  validateDocumentLayoutPermit,
  worseningDocumentLayoutBlockers,
  type DocumentLayoutSnapshotEntry,
} from "../src/index.js";

const entry = (path: string): DocumentLayoutSnapshotEntry => ({
  path,
  contentHash: `sha256:${"a".repeat(64)}`,
  ownership: "user",
});

const policy = {
  ...defaultRepositoryDocumentPolicy.capacity,
  maxDirectDocuments: 2,
  maxDocumentBearingChildDirectories: 2,
  maxRepositoryDocuments: 8,
};

describe("projected document layout", () => {
  it("blocks a create and move projected into a full directory", () => {
    const create = evaluateDocumentLayout({
      snapshot: [entry("README.md"), entry("docs/a.md"), entry("docs/b.md")],
      operations: [
        {
          operationId: "create-c",
          action: "create",
          path: "docs/c.md",
          contentHash: `sha256:${"b".repeat(64)}`,
        },
      ],
      policy,
      roles: defaultRepositoryDocumentPolicy.roles,
    });
    expect(create.blockers).toContainEqual(
      expect.objectContaining({
        code: "document_directory_file_capacity_exceeded",
        directory: "docs",
        observed: 2,
        projected: 3,
        operationIds: ["create-c"],
      }),
    );

    const move = evaluateDocumentLayout({
      snapshot: [entry("README.md"), entry("docs/a.md"), entry("docs/b.md"), entry("notes/c.md")],
      operations: [
        {
          operationId: "move-c",
          action: "move",
          path: "notes/c.md",
          destinationPath: "docs/c.md",
          contentHash: `sha256:${"a".repeat(64)}`,
        },
      ],
      policy,
      roles: defaultRepositoryDocumentPolicy.roles,
    });
    expect(move.blockers).toContainEqual(
      expect.objectContaining({
        code: "document_directory_file_capacity_exceeded",
        directory: "docs",
        operationIds: ["move-c"],
      }),
    );
  });

  it("keeps existing overflow visible without blocking writes that do not grow it", () => {
    const snapshot = [
      entry("README.md"),
      entry("notes/a.md"),
      entry("notes/b.md"),
      entry("notes/c.md"),
      entry("docs/a.md"),
    ];
    const write = (operation: Parameters<typeof evaluateDocumentLayout>[0]["operations"][number]) =>
      evaluateDocumentLayout({
        snapshot,
        operations: [operation],
        policy,
        roles: defaultRepositoryDocumentPolicy.roles,
      });
    const hash = `sha256:${"b".repeat(64)}`;

    const unrelated = write({
      operationId: "create-b",
      action: "create",
      path: "docs/b.md",
      contentHash: hash,
    });
    expect(unrelated.status).toBe("bounded");
    expect(unrelated.blockers).toContainEqual(
      expect.objectContaining({ directory: "notes", observed: 3, projected: 3 }),
    );
    expect(worseningDocumentLayoutBlockers(unrelated)).toEqual([]);
    expect(() => createDocumentLayoutPermit(unrelated)).not.toThrow();

    const inPlace = write({
      operationId: "update-a",
      action: "update",
      path: "notes/a.md",
      contentHash: hash,
    });
    expect(inPlace.status).toBe("bounded");

    const shrink = write({ operationId: "delete-a", action: "delete", path: "notes/a.md" });
    expect(shrink.status).toBe("bounded");

    const grow = write({
      operationId: "create-d",
      action: "create",
      path: "notes/d.md",
      contentHash: hash,
    });
    expect(grow.status).toBe("blocked");
    expect(worseningDocumentLayoutBlockers(grow)).toEqual([
      expect.objectContaining({ directory: "notes", observed: 3, projected: 4 }),
    ]);
    expect(() => createDocumentLayoutPermit(grow)).toThrow();
  });

  it("counts document-bearing direct children and honors a bounded catalog override", () => {
    const snapshot = [
      entry("README.md"),
      entry("docs/a/one.md"),
      entry("docs/b/two.md"),
      entry("catalog/one.md"),
      entry("catalog/two.md"),
      entry("catalog/three.md"),
    ];
    const blocked = evaluateDocumentLayout({
      snapshot,
      operations: [
        {
          operationId: "create-child",
          action: "create",
          path: "docs/c/three.md",
          contentHash: `sha256:${"b".repeat(64)}`,
        },
      ],
      policy,
      roles: defaultRepositoryDocumentPolicy.roles,
    });
    expect(blocked.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "document_directory_child_capacity_exceeded" }),
        expect.objectContaining({
          code: "document_directory_file_capacity_exceeded",
          directory: "catalog",
        }),
      ]),
    );

    const bounded = evaluateDocumentLayout({
      snapshot: snapshot.slice(0, -1),
      operations: [],
      policy: {
        ...policy,
        overrides: [
          {
            scopePath: "catalog",
            role: "catalog",
            maxDirectDocuments: 4,
            maxDocumentBearingChildDirectories: 2,
          },
        ],
      },
      roles: defaultRepositoryDocumentPolicy.roles,
    });
    expect(bounded.status).toBe("bounded");
  });

  it("binds permits to snapshot, policy, roles, operations, counts, and expiry", () => {
    const evaluation = evaluateDocumentLayout({
      snapshot: [entry("README.md")],
      operations: [],
      policy,
      roles: defaultRepositoryDocumentPolicy.roles,
    });
    const now = new Date("2026-08-26T00:00:00.000Z");
    const permit = createDocumentLayoutPermit(evaluation, now, 1_000);
    expect(validateDocumentLayoutPermit({ permit, evaluation, now })).toBe(true);
    expect(
      validateDocumentLayoutPermit({
        permit,
        evaluation,
        now: new Date("2026-08-26T00:00:01.000Z"),
      }),
    ).toBe(false);
    expect(
      validateDocumentLayoutPermit({
        permit: { ...permit, issuedAt: "not-a-date" },
        evaluation,
        now,
      }),
    ).toBe(false);
    expect(
      validateDocumentLayoutPermit({
        permit: { ...permit, operationSetHash: `sha256:${"f".repeat(64)}` },
        evaluation,
        now,
      }),
    ).toBe(false);
  });
});
