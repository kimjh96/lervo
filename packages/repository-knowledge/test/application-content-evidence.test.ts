import { describe, expect, it } from "vitest";

import {
  observeApplicationContent,
  type ApplicationContentSource,
} from "../src/application-content-evidence.js";

function source(
  path: string,
  content = "",
  kind: ApplicationContentSource["kind"] = "code",
): ApplicationContentSource {
  return { path, kind, status: "included", content };
}

function observe(sources: ApplicationContentSource[], documentPaths: string[]) {
  return observeApplicationContent({ sources, documentPaths, documentationRoot: "docs" });
}

describe("application content evidence", () => {
  it("resolves imports, static template prefixes, and joined path arguments within a package", () => {
    const evidence = observe(
      [
        source("apps/web/package.json", "{}", "build_definition"),
        source("apps/web/src/guide.ts", 'import guide from "./content/guide.md";\n'),
        source("apps/web/src/posts.ts", "export const post = (slug) => `../posts/${slug}.md`;\n"),
        source("apps/web/lib/load.ts", 'join(process.cwd(), "data", "faq");\n'),
        source("apps/web/src/content/guide.md", "# Guide\n", "documentation"),
        source("apps/web/posts/first.md", "# First\n", "documentation"),
        source("apps/web/data/faq/answers.md", "# Answers\n", "documentation"),
      ],
      ["apps/web/src/content/guide.md", "apps/web/posts/first.md", "apps/web/data/faq/answers.md"],
    );

    expect(evidence.get("apps/web/src/content/guide.md")).toEqual([
      {
        kind: "source_reference",
        packageRoot: "apps/web",
        sourcePath: "apps/web/src/guide.ts",
        target: "apps/web/src/content/guide.md",
        targetKind: "document",
      },
    ]);
    expect(evidence.get("apps/web/posts/first.md")).toEqual([
      expect.objectContaining({ target: "apps/web/posts", targetKind: "directory" }),
    ]);
    expect(evidence.get("apps/web/data/faq/answers.md")).toEqual([
      expect.objectContaining({
        sourcePath: "apps/web/lib/load.ts",
        target: "apps/web/data/faq",
        targetKind: "directory",
      }),
    ]);
  });

  it("accepts a content glob only when it admits the document's extension", () => {
    const sources = [
      source("site/package.json", "{}", "build_definition"),
      source("site/content.config.mjs", 'export default { include: ["content/**/*.mdx"] };\n'),
      source("site/content/a.mdx", "# A\n", "documentation"),
      source("site/content/b.md", "# B\n", "documentation"),
    ];

    const evidence = observe(sources, ["site/content/a.mdx", "site/content/b.md"]);

    expect(evidence.get("site/content/a.mdx")).toEqual([
      expect.objectContaining({ target: "site/content", targetKind: "glob" }),
    ]);
    expect(evidence.has("site/content/b.md")).toBe(false);
  });

  it("records a document inside a directory tree that holds the package's own modules", () => {
    const evidence = observe(
      [
        source("apps/web/package.json", "{}", "build_definition"),
        source("apps/web/app/docs/page.tsx", "export default function Page() {}\n"),
        source("apps/web/app/docs/_data/intro.md", "# Intro\n", "documentation"),
      ],
      ["apps/web/app/docs/_data/intro.md"],
    );

    expect(evidence.get("apps/web/app/docs/_data/intro.md")).toEqual([
      {
        kind: "source_tree_member",
        packageRoot: "apps/web",
        sourceTree: "apps/web/app/docs",
        sourcePath: "apps/web/app/docs/page.tsx",
      },
    ]);
  });

  it("gives no evidence across packages, from tests, at a package root, or under the documentation root", () => {
    const evidence = observe(
      [
        source("package.json", "{}", "build_definition"),
        source("scripts/check-docs.mjs", 'const notes = "docs/notes";\nconst all = "**/*.md";\n'),
        source("packages/api/package.json", "{}", "build_definition"),
        source("packages/api/test/guide.test.ts", 'read("../guides/usage.md");\n', "test"),
        source("packages/api/src/index.ts", 'export const root = ".";\nexport const r = "./";\n'),
        source("packages/web/package.json", "{}", "build_definition"),
        source("packages/web/src/load.ts", 'read("../../api/guides/usage.md");\n'),
        source("packages/api/guides/usage.md", "# Usage\n", "documentation"),
        source("docs/notes/legacy.md", "# Legacy\n", "documentation"),
        source("notes/outside.md", "# Outside\n", "documentation"),
      ],
      ["packages/api/guides/usage.md", "docs/notes/legacy.md", "notes/outside.md"],
    );

    expect(evidence.size).toBe(0);
  });

  it("ignores Markdown outside any declared workspace package", () => {
    expect(
      observe(
        [
          source("tools/render.ts", 'read("../notes/page.md");\n'),
          source("notes/page.md", "# Page\n", "documentation"),
        ],
        ["notes/page.md"],
      ).size,
    ).toBe(0);
  });
});
