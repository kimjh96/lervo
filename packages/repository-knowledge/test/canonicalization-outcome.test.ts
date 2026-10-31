import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { assessCanonicalization, parseCanonicalizationOutcome, sha256 } from "../src/index.js";

const roots: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-canonical-outcome-"));
  roots.push(root);
  await mkdir(resolve(root, "apps/example/src"), { recursive: true });
  await mkdir(resolve(root, "docs/specs"), { recursive: true });
  await writeFile(resolve(root, "apps/example/src/value.ts"), "export const value = 2;\n");
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("canonicalization outcomes", () => {
  it("rejects the retired portable-skill outcome for new declarations", () => {
    expect(() =>
      parseCanonicalizationOutcome({
        schemaVersion: 1,
        kind: "portable_skill_candidate",
        summary: "A historical workflow proposal must not create a new pattern.",
        sourcePaths: ["apps/example/src/value.ts"],
        proposal: {},
      }),
    ).toThrow("The canonicalization outcome is invalid");
  });

  it("binds an exact changed canonical target to every changed noncanonical source", async () => {
    const root = await repository();
    const sourcePath = "apps/example/src/value.ts";
    const targetPath = "docs/specs/value.md";
    const target = "# Value\n\nThe exported value is two.\n";
    await writeFile(resolve(root, targetPath), target);

    const result = await assessCanonicalization({
      repositoryRoot: root,
      beforeRevision: sha256("before"),
      afterRevision: sha256("after"),
      beforeFiles: {
        [sourcePath]: sha256("export const value = 1;\n"),
        [targetPath]: sha256("# Value\n\nThe exported value is one.\n"),
      },
      afterFiles: {
        [sourcePath]: sha256("export const value = 2;\n"),
        [targetPath]: sha256(target),
      },
      disposition: "canonical_sources_updated",
      outcome: {
        schemaVersion: 1,
        kind: "canonical_update",
        summary: "The value contract changed with its implementation.",
        targets: [{ path: targetPath, contentHash: sha256(target), sourcePaths: [sourcePath] }],
      },
      now: new Date("2026-09-04T00:00:00.000Z"),
    });

    expect(result).toMatchObject({ status: "current", candidate: null });
  });

  it("rejects an outcome that omits one changed source", async () => {
    const root = await repository();
    const targetPath = "docs/specs/value.md";
    const target = "# Value\n\nThe exported value is two.\n";
    await writeFile(resolve(root, targetPath), target);

    await expect(
      assessCanonicalization({
        repositoryRoot: root,
        beforeRevision: sha256("before"),
        afterRevision: sha256("after"),
        beforeFiles: { "apps/example/src/value.ts": sha256("before source") },
        afterFiles: {
          "apps/example/src/value.ts": sha256("after source"),
          [targetPath]: sha256(target),
        },
        disposition: "canonical_sources_updated",
        outcome: {
          schemaVersion: 1,
          kind: "canonical_update",
          summary: "An incomplete outcome must fail.",
          targets: [{ path: targetPath, contentHash: sha256(target), sourcePaths: [] }],
        },
        now: new Date("2026-09-04T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "knowledge_approval_required" });
  });

  it("stores a bounded review draft as candidate state without promoting it", async () => {
    const root = await repository();
    const sourcePath = "apps/example/src/value.ts";
    const proposedMarkdown = "# Value\n\nThe exported value is two.\n";
    const result = await assessCanonicalization({
      repositoryRoot: root,
      beforeRevision: sha256("before"),
      afterRevision: sha256("after"),
      beforeFiles: { [sourcePath]: sha256("export const value = 1;\n") },
      afterFiles: { [sourcePath]: sha256("export const value = 2;\n") },
      disposition: "pending_user_approval",
      outcome: {
        schemaVersion: 1,
        kind: "review_draft",
        summary: "A specification update is proposed for exact review.",
        drafts: [
          {
            targetPath: "docs/specs/value.md",
            sourcePaths: [sourcePath],
            proposedMarkdown,
            proposedContentHash: sha256(proposedMarkdown),
          },
        ],
      },
      now: new Date("2026-09-04T00:00:00.000Z"),
    });

    expect(result).toMatchObject({
      status: "pending",
      candidate: {
        observedState: "pending",
        outcome: {
          kind: "review_draft",
          drafts: [
            {
              targetPath: "docs/specs/value.md",
              proposedContentHash: sha256(proposedMarkdown),
            },
          ],
        },
      },
    });
  });
});
