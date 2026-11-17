import type { RepositoryLayoutMigrationPlan } from "@lervo/repository-knowledge";
import { describe, expect, it, vi } from "vitest";

const layoutCapacity: NonNullable<RepositoryLayoutMigrationPlan["layoutCapacity"]> = [
  {
    code: "document_directory_file_capacity_exceeded",
    directory: "docs/quality",
    observed: 0,
    projected: 33,
    limit: 32,
    disposition: "moves_held",
  },
  {
    code: "document_directory_file_capacity_exceeded",
    directory: "v8/notes",
    observed: 181,
    projected: 181,
    limit: 32,
    disposition: "existing_overflow",
  },
];

const migration = vi.hoisted(() => ({ output: null as unknown }));
vi.mock("../src/knowledge-command.js", () => ({
  runKnowledgeCommand: vi.fn(),
  runKnowledgeMigration: async (input: {
    io: { stdout(message: string): void };
    observeLayout?: (layout: unknown) => void;
  }) => {
    input.observeLayout?.({ deferredDocuments: [], layoutCapacity });
    input.io.stdout(`${JSON.stringify(migration.output)}\n`);
    return 1;
  },
}));

const { inspectKnowledge } = await import("../src/upgrade-stage-inspection.js");
const { formatRepositoryLayoutMigrationPlan } =
  await import("../src/knowledge-migration-format.js");
const { layoutCapacityLines } = await import("../src/layout-capacity-lines.js");

describe("layout capacity in upgrade and migration reports (ADR-0583)", () => {
  it("carries the directory, counts, and limit into the upgrade knowledge stage", async () => {
    const message =
      "The projected repository document layout is blocked by document_directory_file_capacity_exceeded in docs/quality (observed 0, projected 33, limit 32).";
    migration.output = {
      schemaVersion: 1,
      status: "failed",
      error: { code: "document_directory_file_capacity_exceeded", message },
    };
    expect(await inspectKnowledge("/repository")).toMatchObject({
      disposition: "blocked",
      reason: "document_directory_file_capacity_exceeded",
      blockers: [{ code: "document_directory_file_capacity_exceeded", message }],
      layoutCapacity,
      layoutCapacityCount: 2,
    });
  });

  it("prints one line per directory in upgrade and migration text", () => {
    const lines = layoutCapacityLines(layoutCapacity, "  ");
    expect(lines).toEqual([
      "  Directories over document capacity: 2",
      "    docs/quality: documents observed 0, projected 33, limit 32 (moves into it are held; sources stay in place)",
      "    v8/notes: documents observed 181, projected 181, limit 32 (existing overflow, not blocking; this plan adds nothing there)",
    ]);
    expect(layoutCapacityLines(layoutCapacity.slice(0, 1), "", 40)[0]).toBe(
      "Directories over document capacity: 40",
    );
    const text = formatRepositoryLayoutMigrationPlan({
      repositoryRoot: "/repository",
      planId: "klayout_000000000000000000000000",
      status: "current",
      deferredDocumentCount: 0,
      deferredDocuments: [],
      moves: [],
      userUpdates: [],
      machineMoves: [],
      referenceUpdates: [],
      retainedDocuments: [],
      retainedDocumentCount: 0,
      blockers: [],
      operations: [],
      layoutCapacity,
    } as unknown as RepositoryLayoutMigrationPlan);
    expect(text).toContain(
      "v8/notes: documents observed 181, projected 181, limit 32 (existing overflow, not blocking; this plan adds nothing there)",
    );
  });
});
