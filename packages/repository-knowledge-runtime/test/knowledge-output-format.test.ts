import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { formatSettledKnowledgeOutputs } from "../src/knowledge-output-commit.js";
import { knowledgeOutputFormatTargets } from "../src/knowledge-output-format-scope.js";
import {
  loadRepositoryKnowledgeOutputFormatter,
  type KnowledgeOutputFormatter,
} from "../src/knowledge-output-formatter.js";

const execute = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../../..");
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

const record = (...outputs: string[]) =>
  `schemaVersion: 2\nbyteOwnership:\n  owner: reviewer\n  rewritePolicy: reviewed_exact\noutputs:\n${outputs.map((path) => `  - path: ${path}\n`).join("")}`;

/** Strips trailing spaces from Markdown; every other path is not the formatter's. */
const trailingSpaceFormatter: KnowledgeOutputFormatter = {
  format: async (path, content) =>
    path.endsWith(".md") ? content.replace(/[ \t]+$/gmu, "") : null,
};

describe("knowledge output format targets", () => {
  it("formats changed and released paths, never lifecycle-owned bytes or ownership sources", () => {
    const retired = ".lervo/knowledge/document-normalizations/aa/knormdoc_a.yaml";
    const current = ".lervo/knowledge/document-normalizations/bb/knormdoc_b.yaml";
    expect(
      knowledgeOutputFormatTargets({
        changedPresentPaths: ["docs/new.md", "docs/owned.md", current],
        changedSourcesBefore: new Map([[retired, record("docs/owned.md", "docs/released.md")]]),
        sourcesAfter: new Map([
          [current, record("docs/owned.md")],
          [
            ".lervo/documents/doc_1.yaml",
            "schemaVersion: 1\nrecord:\n  path: docs/managed.md\n  ownership:\n    mode: managed_blocks\n",
          ],
          [".lervo/knowledge/document-normalizations/cc/broken.yaml", "outputs: [\n"],
        ]),
      }),
    ).toEqual(["docs/new.md", "docs/released.md"]);
  });
});

describe("settled output formatting", () => {
  it(
    "formats selected and clean released outputs and leaves developer edits alone",
    { timeout: 30_000 },
    async () => {
      const root = await mkdtemp(resolve(tmpdir(), "lervo-knowledge-format-"));
      directories.push(root);
      const git = (...args: string[]) =>
        execute("git", ["-C", root, ...args], {
          env: {
            ...process.env,
            GIT_AUTHOR_NAME: "Developer",
            GIT_AUTHOR_EMAIL: "dev@example.com",
            GIT_COMMITTER_NAME: "Developer",
            GIT_COMMITTER_EMAIL: "dev@example.com",
          },
        });
      const write = async (path: string, content: string) => {
        await mkdir(resolve(root, path, ".."), { recursive: true });
        await writeFile(resolve(root, path), content);
      };
      const retired = ".lervo/knowledge/document-normalizations/aa/knormdoc_a.yaml";
      const replacement = ".lervo/knowledge/document-normalizations/bb/knormdoc_b.yaml";
      await git("init", "--quiet", "-b", "main");
      await write(retired, record("docs/kept.md", "docs/released.md", "docs/edited.md"));
      await write("docs/kept.md", "# Kept  \n");
      await write("docs/released.md", "# Released  \n");
      await write("docs/edited.md", "# Edited  \n");
      await git("add", "-A");
      await git("commit", "--quiet", "-m", "docs: seed");
      // Convergence retires the record for one that keeps only docs/kept.md, and writes a draft.
      await rm(resolve(root, retired));
      await write(replacement, record("docs/kept.md", "docs/draft.md"));
      await write("docs/kept.md", "# Kept again  \n");
      await write("docs/draft.md", "# Draft  \n");
      await write("docs/integrated.md", "# Integrated  \n");
      await write("docs/edited.md", "# Developer edit  \n");

      const result = await formatSettledKnowledgeOutputs({
        repositoryRoot: root,
        formatter: trailingSpaceFormatter,
        selected: [retired, replacement, "docs/kept.md", "docs/draft.md", "docs/integrated.md"],
        dirty: new Map([
          [retired, "deleted"],
          [replacement, "present"],
          ["docs/kept.md", "present"],
          ["docs/draft.md", "present"],
          ["docs/integrated.md", "present"],
          ["docs/edited.md", "present"],
        ]),
      });
      expect(result.paths).toEqual(
        [
          retired,
          replacement,
          "docs/draft.md",
          "docs/integrated.md",
          "docs/kept.md",
          "docs/released.md",
        ].sort(),
      );
      expect([...result.replaced.keys()]).toEqual(["docs/integrated.md", "docs/released.md"]);
      const read = (path: string) => readFile(resolve(root, path), "utf8");
      expect(await read("docs/integrated.md")).toBe("# Integrated\n");
      expect(await read("docs/released.md")).toBe("# Released\n");
      // Lifecycle-owned outputs keep their reviewed bytes; a developer's edit is never touched.
      expect(await read("docs/kept.md")).toBe("# Kept again  \n");
      expect(await read("docs/draft.md")).toBe("# Draft  \n");
      expect(await read("docs/edited.md")).toBe("# Developer edit  \n");
    },
  );
});

describe("repository formatter", () => {
  it("formats with the repository's own Prettier and configuration", async () => {
    const formatter = await loadRepositoryKnowledgeOutputFormatter(repositoryRoot);
    expect(formatter).not.toBeNull();
    const ignore = resolve(repositoryRoot, ".prettierignore");
    // The table PR #49 published unaligned failed `pnpm format:check`.
    const table = "| State | Meaning |\n| --- | --- |\n| `pending` | Host-ready |\n";
    expect(
      await formatter!.format(resolve(repositoryRoot, "docs/specifications/new.md"), table, ignore),
    ).toBe("| State     | Meaning    |\n| --------- | ---------- |\n| `pending` | Host-ready |\n");
    expect(
      await formatter!.format(
        resolve(repositoryRoot, ".lervo/knowledge/document-normalizations/aa/knormdoc_a.yaml"),
        "a:   1\n",
        ignore,
      ),
    ).toBeNull();
  });

  it("is absent in a repository without Prettier", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-knowledge-format-none-"));
    directories.push(root);
    expect(await loadRepositoryKnowledgeOutputFormatter(root)).toBeNull();
  });
});
