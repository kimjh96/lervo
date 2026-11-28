import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyDocumentSizeSplitPlan,
  applyKnowledgeMigrationPlan,
  brokenRewrites,
  createDocumentSizeSplitPlan,
  createKnowledgeMigrationPlan,
  documentHeadingAnchors,
  documentSizeSplittable,
  inspectConfiguredDocumentNormalization,
  restoreSplitPiece,
  splitDocuments,
  splitOversizedDocument,
  verifyDocumentSizeSplitPlan,
  type SplitDocument,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(files: Record<string, string | Buffer>): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-document-size-split-edges-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(resolve(root, path, ".."), { recursive: true });
    await writeFile(resolve(root, path), content);
  }
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_size_split",
      now: new Date("2026-11-28T00:00:00Z"),
    }),
  );
  const migration = await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" });
  await applyKnowledgeMigrationPlan(migration, new Date("2026-11-28T00:01:00Z"), () => undefined);
  return root;
}

const filler = (count: number) =>
  Array.from({ length: count }, (_, index) => `Paragraph ${index} ${"x".repeat(80)}\n\n`).join("");

/** A document of `count` sections of about 900 bytes, over 256 KiB from 300 sections. */
const body = (title: string, count: number, extra = "") =>
  [
    `# ${title}`,
    "",
    "Intro.",
    "",
    ...Array.from({ length: count }, (_, index) => [
      `## S${index}`,
      "",
      `${index === 5 ? extra : ""}${"x".repeat(900)}`,
      "",
    ]).flat(),
  ].join("\n");

function split(path: string, content: string, bound = 2_048): SplitDocument {
  const result = splitOversizedDocument(path, content, bound);
  if (typeof result === "string") throw new Error(`kept whole: ${result}`);
  for (const piece of [result.index, ...result.parts])
    expect(
      restoreSplitPiece(content, piece.content, {
        ...piece,
        ...(piece === result.index ? { block: result.index.block } : {}),
      }),
    ).toBeNull();
  return result;
}

const holding = (result: SplitDocument, text: string) =>
  [result.index, ...result.parts].find((piece) => piece.content.includes(text))!;

describe("document size split edges", () => {
  it("keeps a leading front-matter block whole in the document's own file", () => {
    const frontMatter = "---\ntitle: Big\nsummary: kept\n---\n";
    const content = `${frontMatter}\n${filler(15)}## A\n\n${filler(15)}## B\n\n${filler(15)}`;
    const result = split("docs/big.md", content);
    expect(result.index.content.startsWith(`${frontMatter}\n`)).toBe(true);
    expect(result.parts.some((part) => part.content.includes("summary: kept"))).toBe(false);
    expect(documentHeadingAnchors(content).map((item) => item.anchor)).toEqual(["a", "b"]);
  });

  it("keeps a byte order mark at the start of the document's own file only", () => {
    const content = `\uFEFF# T\n\n${filler(15)}## A\n\nSee [b](#b) and [o](other.md).\n\n${filler(15)}## B\n\n${filler(15)}`;
    const result = split("docs/big.md", content);
    expect(result.index.content.startsWith("\uFEFF# T")).toBe(true);
    expect(result.parts.every((part) => !part.content.includes("\uFEFF"))).toBe(true);
    expect(holding(result, "See [b]").content).toContain("[o](../other.md)");
  });

  it("rebases HTML src and href in a moved part and keeps escaped destinations as written", () => {
    const b = `<img src="./img/x.png" width="20">\n\n<a href="other.md">o</a> and [p](a\\(b.md) and [e](a&amp;b.md)`;
    const result = split("docs/big.md", `# T\n\n${filler(15)}## B\n\n${b}\n\n${filler(15)}`);
    const part = holding(result, "<img").content;
    expect(part).toContain('<img src="../img/x.png" width="20">');
    expect(part).toContain('<a href="../other.md">o</a>');
    expect(part).toContain("[p](../a\\(b.md)");
    expect(part).toContain("[e](../a&amp;b.md)");
  });

  it("never rewrites a footnote and copies each footnote definition with its reference", () => {
    const content = [
      "# T",
      "",
      "Intro.",
      "",
      "## A",
      "",
      "Use[^long], again[^1], and[^c].",
      "",
      filler(15),
      "## B",
      "",
      filler(15),
      "[^long]: See the RFC for details.",
      "",
      "[^1]: Ibid.",
      "",
      "[^c]: First line.",
      "",
      "    Continued paragraph.",
      "",
    ].join("\n");
    const result = split("docs/big.md", content);
    const a = holding(result, "Use[^long]");
    expect(a.prefix).toContain("[^long]: See the RFC for details.");
    expect(a.prefix).toContain("[^1]: Ibid.");
    expect(a.content).not.toContain("../Ibid.");
    expect(holding(result, "[^1]: Ibid.\n\n[^c]").content).not.toContain("../Ibid.");
    expect(result.unkept).toContain("[^c] (its definition is not copied)");
  });

  it("copies a block-quoted definition bare, without its quote marker", () => {
    const content = `# T\n\nIntro.\n\n## A\n\nUse [x][d] and [y][e].\n\n${filler(15)}## B\n\n> [d]: x.md\n> [e]: <y z.md> "Title"\n\n${filler(15)}`;
    const a = holding(split("docs/big.md", content), "Use [x][d]");
    expect(a.prefix).toBe('[d]: x.md\n[e]: <y z.md> "Title"\n\n');
    expect(a.content.startsWith('[d]: ../x.md\n[e]: <../y z.md> "Title"\n\n')).toBe(true);
  });

  it("splits a part that opens with a thematic break like any other part", () => {
    const content = `# T\n\nIntro.\n\n## A\n\n${filler(15)}---\n\nSee [o](other.md).\n\n---\n\n${filler(15)}`;
    expect(holding(split("docs/big.md", content), "See [o]").content).toContain("[o](../other.md)");
  });

  it("follows a heading named by a link with a query, and renders unchanged documents once", () => {
    const other = `# Other\n\n${filler(10)}## Target\n\n${filler(30)}`;
    const linking = `# T\n\nIntro.\n\n## A\n\n${filler(15)}## B\n\nsee [t](other.md?plain=1#target)\n\n${filler(15)}`;
    const results = splitDocuments(
      [
        { path: "docs/big.md", content: linking },
        { path: "docs/other.md", content: other },
      ],
      2_048,
    );
    expect(results.map((item) => item.settled)).toEqual([true, true]);
    const [big, target] = results.map((item) => item.split as SplitDocument);
    const holder = holding(target!, "## Target");
    expect(holding(big!, "see [t]").content).toContain(
      `](../other/${holder.path.split("/").pop()}?plain=1#target)`,
    );
  });

  it("names a rewritten link that would not name what it named once the plan is written", () => {
    const anchors = new Map([
      [
        "docs/other.md",
        new Map([["target", { file: "docs/other/02-target.md", anchor: "target" }]]),
      ],
    ]);
    const check = (after: string, writes: string[]) =>
      brokenRewrites({
        documentPath: "docs/big.md",
        pieces: [
          {
            path: "docs/big/01-a.md",
            rewrites: [{ start: 0, end: 15, before: "other.md#target", after }],
          },
        ],
        writes: new Set(writes),
        anchorFiles: anchors,
      });
    expect(check("../other/02-target.md#target", ["docs/other/02-target.md"])).toEqual([]);
    expect(check("../other/02-target.md#target", [])).toHaveLength(1);
    expect(check("../other/02-target.md#elsewhere", ["docs/other/02-target.md"])).toHaveLength(1);
    expect(check("other.md#target", ["docs/other/02-target.md"])).toHaveLength(1);
  });

  it("tells a document a split can divide from one it keeps whole", () => {
    expect(documentSizeSplittable(body("Big", 400))).toBe(true);
    expect(documentSizeSplittable(`# Dump\n\n\`\`\`\n${"x\n".repeat(200_000)}\`\`\`\n`)).toBe(
      false,
    );
  });
});

describe("document size split plan edges", () => {
  it("splits a document and a linking document with a byte order mark, keeping each mark", async () => {
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const root = await repository({
      "docs/big.md": Buffer.concat([bom, Buffer.from(body("Big", 400))]),
      "docs/linker.md": Buffer.concat([bom, Buffer.from("# Linker\n\nSee [s](big.md#s300).\n")]),
    });
    const normalization = await inspectConfiguredDocumentNormalization({ repositoryRoot: root });
    const sourcePaths = normalization.oversizedDocuments.map((item) => item.path);
    expect(normalization.oversizedDocuments).toEqual([
      expect.objectContaining({ path: "docs/big.md", splittable: true }),
    ]);
    const plan = await createDocumentSizeSplitPlan({ repositoryRoot: root, sourcePaths });
    expect(plan.failed).toEqual([]);
    expect(plan.referenceUpdates.map((item) => item.path)).toEqual(["docs/linker.md"]);
    expect(await verifyDocumentSizeSplitPlan(plan)).toMatchObject({ agreed: true });
    await applyDocumentSizeSplitPlan({
      plan,
      sourcePaths,
      approvedOperationId: plan.operationId,
      approvedHash: plan.approvalHash,
      now: new Date("2026-11-28T00:02:00Z"),
      recordApplied: () => undefined,
    });
    for (const path of ["docs/big.md", "docs/linker.md"])
      expect((await readFile(resolve(root, path))).subarray(0, 3).equals(bom)).toBe(true);
    expect(await readFile(resolve(root, "docs/linker.md"), "utf8")).toContain("](big/");
  }, 120_000);

  it("points links into a document left whole at that document, never at its unwritten parts", async () => {
    const other = body("Other", 400);
    const taken = (splitOversizedDocument("docs/other.md", other) as SplitDocument).parts[0]!.path;
    const root = await repository({
      "docs/big.md": body("Big", 400, "See [o](other.md#s300). "),
      "docs/other.md": other,
      [taken]: "# Taken\n",
    });
    const normalization = await inspectConfiguredDocumentNormalization({ repositoryRoot: root });
    const plan = await createDocumentSizeSplitPlan({
      repositoryRoot: root,
      sourcePaths: normalization.oversizedDocuments.map((item) => item.path),
    });
    expect(plan.documents.map((item) => item.path)).toEqual(["docs/big.md"]);
    expect(plan.failed).toEqual([
      { path: "docs/other.md", reason: expect.stringContaining("document_split_failed") },
    ]);
    const linking = plan.operations.find((operation) => operation.content?.includes("See [o]("))!;
    expect(linking.content).toContain("See [o](../other.md#s300)");
    expect(await verifyDocumentSizeSplitPlan(plan)).toMatchObject({ agreed: true });
  }, 120_000);
});
