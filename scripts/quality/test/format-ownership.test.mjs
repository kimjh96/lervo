import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { lervoLifecycleOwnedFormatPaths } from "../lib/format-ownership.mjs";

const roots = [];
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

async function fixture(content) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-format-ownership-"));
  roots.push(root);
  const directory = resolve(root, ".lervo/knowledge/document-normalizations/ab");
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, "record.yaml"), content, "utf8");
  return root;
}

describe("formatter ownership", () => {
  it("keeps Markdown enabled and routes formatting through the ownership-aware wrapper", async () => {
    const repositoryRoot = resolve(import.meta.dirname, "../../..");
    const ignore = await readFile(resolve(repositoryRoot, ".prettierignore"), "utf8");
    const manifest = JSON.parse(await readFile(resolve(repositoryRoot, "package.json"), "utf8"));
    expect(ignore).not.toContain("**/*.md");
    expect(manifest.scripts.format).toBe("node scripts/quality/run-prettier.mjs --write");
    expect(manifest.scripts["format:check"]).toBe("node scripts/quality/run-prettier.mjs --check");
  });

  it("derives exact lifecycle-owned outputs without excluding unrelated Markdown", async () => {
    const root = await fixture(
      "schemaVersion: 1\noutputs:\n  - path: docs/reviewed.md\n  - path: docs/reviewed/detail.md\n",
    );
    expect([...(await lervoLifecycleOwnedFormatPaths(root))].sort()).toEqual([
      "docs/reviewed.md",
      "docs/reviewed/detail.md",
    ]);
  });

  it("requires explicit reviewed byte ownership on version-2 records", async () => {
    const root = await fixture(
      "schemaVersion: 2\nbyteOwnership:\n  owner: reviewer\n  rewritePolicy: reviewed_exact\noutputs:\n  - path: docs/reviewed.md\n",
    );
    expect([...(await lervoLifecycleOwnedFormatPaths(root))]).toEqual(["docs/reviewed.md"]);
    const invalid = await fixture(
      "schemaVersion: 2\nbyteOwnership:\n  owner: reviewer\n  rewritePolicy: repository_tool\noutputs:\n  - path: docs/reviewed.md\n",
    );
    await expect(lervoLifecycleOwnedFormatPaths(invalid)).rejects.toThrow(
      "Invalid Lervo normalization ownership record",
    );
  });

  it("projects generated and shared-block registry ownership for every rewriter adapter", async () => {
    const root = await fixture("schemaVersion: 1\noutputs:\n  - path: docs/reviewed.md\n");
    const directory = resolve(root, ".lervo/documents");
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, "doc_generated.yaml"),
      "schemaVersion: 1\nrecord:\n  path: docs/generated.md\n  ownership:\n    mode: lervo_generated\n",
    );
    await writeFile(
      resolve(directory, "doc_shared.yaml"),
      "schemaVersion: 1\nrecord:\n  path: AGENTS.md\n  ownership:\n    mode: managed_blocks\n",
    );
    await writeFile(
      resolve(directory, "doc_user.yaml"),
      "schemaVersion: 1\nrecord:\n  path: README.md\n  ownership:\n    mode: user\n",
    );
    expect([...(await lervoLifecycleOwnedFormatPaths(root))].sort()).toEqual([
      "AGENTS.md",
      "docs/generated.md",
      "docs/reviewed.md",
    ]);
  });

  it("fails closed on unsafe or malformed lifecycle ownership", async () => {
    const root = await fixture("schemaVersion: 1\noutputs:\n  - path: ../outside.md\n");
    await expect(lervoLifecycleOwnedFormatPaths(root)).rejects.toThrow(
      "Unsafe Lervo normalization output path",
    );
  });
});
