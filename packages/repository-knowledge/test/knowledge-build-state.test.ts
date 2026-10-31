import { describe, expect, it } from "vitest";

import {
  migrationPlanWritesOnlyRebuildableProjections,
  type KnowledgeMigrationOperation,
} from "../src/index.js";

function operation(
  path: string,
  overrides: Partial<KnowledgeMigrationOperation> = {},
): KnowledgeMigrationOperation {
  return {
    path,
    action: "create",
    ownership: "lervo_generated",
    mediaType: "text/markdown",
    desiredHash: `sha256:${"a".repeat(64)}`,
    ...overrides,
  };
}

const rebuildable = [
  operation(".lervo/state/knowledge/current/structural/manifests/current.json"),
  operation(".lervo/state/knowledge/current/inventory.json"),
  operation("docs/knowledge/index.md"),
];

describe("rebuild-only migration plans", () => {
  it("accepts generated writes under knowledge state and the publication root", () => {
    expect(
      migrationPlanWritesOnlyRebuildableProjections(
        {
          status: "ready",
          operations: [...rebuildable, operation("AGENTS.md", { action: "unchanged" })],
        },
        "docs/knowledge",
      ),
    ).toBe(true);
  });

  it.each([
    ["a tracked entrypoint", operation("AGENTS.md")],
    ["the ignore file", operation(".gitignore", { ownership: "managed_blocks" })],
    ["a user file under the root", operation("docs/knowledge/guide.md", { ownership: "user" })],
    ["a conflict", operation("docs/knowledge/index.md", { action: "conflict" })],
    ["a sibling of the root", operation("docs/knowledge-base/index.md")],
    ["other local state", operation(".lervo/state/workstreams/current.json")],
  ])("rejects %s", (_label, extra) => {
    expect(
      migrationPlanWritesOnlyRebuildableProjections(
        { status: "ready", operations: [...rebuildable, extra] },
        "docs/knowledge",
      ),
    ).toBe(false);
  });

  it("rejects a plan that is not ready", () => {
    expect(
      migrationPlanWritesOnlyRebuildableProjections(
        { status: "blocked", operations: rebuildable },
        "docs/knowledge",
      ),
    ).toBe(false);
  });
});
