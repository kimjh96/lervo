import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyDocumentSizeSplitPlan,
  applyKnowledgeMigrationPlan,
  createDocumentSizeSplitPlan,
  createKnowledgeMigrationPlan,
  documentSizePartPaths,
  inspectConfiguredDocumentNormalization,
  lintRepositoryKnowledge,
  partitionOversizedMarkdown,
  splitOversizedDocument,
  verifyDocumentSizeSplitPlan,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A deterministic pseudo-random sequence, so a failing case reproduces. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Markdown with nested headings, fenced code, lists, tables, and multibyte text. */
function document(seed: number, sections: number): string {
  const next = random(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
  const lines = ["# Ledger", "", "Intro with a [link](../other/guide.md) and 한국어.", ""];
  for (let section = 0; section < sections; section += 1) {
    lines.push(
      `${"#".repeat(pick([2, 2, 3, 4]))} Section ${section} ${pick(["", "절삭", "공구"])}`,
      "",
    );
    const blocks = 1 + Math.floor(next() * 6);
    for (let block = 0; block < blocks; block += 1) {
      const kind = pick(["paragraph", "code", "list", "table"]);
      if (kind === "paragraph") lines.push(`Text ${"x".repeat(Math.floor(next() * 400))} 끝.`, "");
      if (kind === "code")
        lines.push("```", "## not a heading", "", `const v = ${section};`, "```", "");
      if (kind === "list") lines.push("- one", "- two", "  - nested", "");
      if (kind === "table") {
        lines.push("| id | statement |", "|---|---|");
        const rows = 1 + Math.floor(next() * 40);
        for (let row = 0; row < rows; row += 1)
          lines.push(`| R-${section}-${row} | ${"y".repeat(Math.floor(next() * 200))} 표 |`);
        lines.push("");
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function reassemble(content: string, bound: number): { text: string; bytes: number[] } {
  const partition = partitionOversizedMarkdown(content, bound);
  return {
    text:
      content.slice(0, partition.preambleEnd) +
      partition.parts.map((part) => content.slice(part.start, part.end)).join(""),
    bytes: partition.parts.map((part) =>
      part.oversized
        ? 0
        : Buffer.byteLength(`${part.repeatedHeader ?? ""}${content.slice(part.start, part.end)}`),
    ),
  };
}

describe("document size partition", () => {
  it(
    "reassembles every document exactly and bounds every part it could split",
    { timeout: 30_000 },
    () => {
      for (let seed = 1; seed <= 40; seed += 1) {
        const content = document(seed, 20 + seed * 3);
        const bound = 2_000 + seed * 97;
        if (Buffer.byteLength(content) <= bound) continue;
        const { text, bytes } = reassemble(content, bound);
        expect(Buffer.from(text).equals(Buffer.from(content))).toBe(true);
        expect(bytes.every((size) => size <= bound)).toBe(true);
      }
    },
  );

  it("never cuts inside fenced code, and repeats a split table's header rows", () => {
    const fence = ["```", ...Array.from({ length: 400 }, (_, index) => `## line ${index}`), "```"];
    const table = [
      "| id | statement |",
      "|---|---|",
      ...Array.from({ length: 2_000 }, (_, index) => `| R-${index} | ${"z".repeat(60)} |`),
    ];
    const content = ["# Title", "", ...fence, "", "## Rows", "", ...table, ""].join("\n");
    const partition = partitionOversizedMarkdown(content, 16 * 1024);
    for (const part of partition.parts) {
      const text = content.slice(part.start, part.end);
      expect((text.match(/^```/gmu) ?? []).length % 2).toBe(0);
    }
    const continued = partition.parts.filter((part) => part.repeatedHeader !== null);
    expect(continued.length).toBeGreaterThan(3);
    for (const part of continued) {
      expect(part.repeatedHeader).toBe("| id | statement |\n|---|---|\n");
      expect(content.slice(part.start, part.end).startsWith("| R-")).toBe(true);
    }
  });

  it(
    "splits an axli-sized ledger, one table of 4.6 MB, into parts of at most 256 KiB",
    { timeout: 30_000 },
    () => {
      const rows = Array.from(
        { length: 8_500 },
        (_, index) => `| K-${index} | ${"statement ".repeat(50)} | 한국어 요약 | spec |`,
      );
      const content = [
        "# Knowledge and requirement extraction",
        "",
        "Source set: every specification.",
        "",
        "## Rows",
        "",
        "| id | statement | 요약 | status |",
        "|---|---|---|---|",
        ...rows,
        "",
      ].join("\n");
      expect(Buffer.byteLength(content)).toBeGreaterThan(4_000_000);
      const split = splitOversizedDocument("docs/ledger/sources/knowledge.md", content);
      expect(split.parts.length).toBeGreaterThan(16);
      expect(split.parts.every((part) => Buffer.byteLength(part.content) <= 256 * 1024)).toBe(true);
      expect(split.parts.filter((part) => part.part.oversized)).toEqual([]);
      expect(split.index.startsWith("# Knowledge and requirement extraction\n")).toBe(true);
      expect(split.index).toContain("<!-- lervo:begin block=document-parts schema=1 -->");
    },
  );

  it("rebases a part's relative links to its directory and groups more than 32 parts", () => {
    const content = `# Guide\n\n${Array.from(
      { length: 40 },
      (_, index) => `## Part ${index}\n\nSee [other](../other/guide.md#top) ${"w".repeat(300)}.\n`,
    ).join("\n")}`;
    const split = splitOversizedDocument("docs/specs/guide.md", content, 400);
    expect(split.parts[0]!.content).toContain("](../../../other/guide.md#top)");
    expect(split.parts.length).toBe(40);
    expect(split.parts[33]!.path).toBe("docs/specs/guide/02/34-part-33.md");
    expect(documentSizePartPaths("a.md", ["절삭 공구"])).toEqual(["a/01-part.md"]);
  });
});

async function repository(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-document-size-split-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(resolve(root, path, ".."), { recursive: true }),
    );
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

describe("document size split plan", () => {
  it("splits a registered document and one the scanner left out for its size, keeping every byte", async () => {
    const registered = document(7, 200);
    const unread = document(11, 1_500);
    expect(Buffer.byteLength(registered)).toBeGreaterThan(256 * 1024);
    expect(Buffer.byteLength(unread)).toBeGreaterThan(1024 * 1024);
    const root = await repository({
      "docs/specs/acceptance.md": registered,
      "docs/ledger/final.md": unread,
      "docs/specs/small.md": "# Small\n\nKept as it is.\n",
    });
    const normalization = await inspectConfiguredDocumentNormalization({ repositoryRoot: root });
    expect(normalization.oversizedDocuments.map((item) => item.path)).toEqual([
      "docs/specs/acceptance.md",
    ]);
    expect(normalization.pendingDocuments).not.toContain("docs/specs/acceptance.md");
    const sourcePaths = normalization.oversizedDocuments.map((item) => item.path);
    const plan = await createDocumentSizeSplitPlan({ repositoryRoot: root, sourcePaths });
    expect(plan.documents.map((item) => item.path)).toEqual([
      "docs/ledger/final.md",
      "docs/specs/acceptance.md",
    ]);
    expect(plan.lineageIds).toHaveLength(
      plan.documents.find((item) => item.path === "docs/specs/acceptance.md")!.parts.length,
    );
    expect(await verifyDocumentSizeSplitPlan(plan)).toMatchObject({ agreed: true });

    await applyDocumentSizeSplitPlan({
      plan,
      sourcePaths,
      approvedOperationId: plan.operationId,
      approvedHash: plan.approvalHash,
      now: new Date("2026-11-28T00:02:00Z"),
      recordApplied: () => undefined,
    });
    for (const [path, original] of [
      ["docs/specs/acceptance.md", registered],
      ["docs/ledger/final.md", unread],
    ] as const) {
      const index = await readFile(resolve(root, path), "utf8");
      const preamble = index.slice(0, index.indexOf("<!-- lervo:begin block=document-parts"));
      const directory = resolve(root, path.slice(0, -".md".length));
      const parts = (await readdir(directory)).sort();
      const planned = plan.documents.find((item) => item.path === path)!;
      expect(parts).toEqual(planned.parts.map((part) => part.path.split("/").pop()));
      const ranges = planned.parts.map((part) =>
        Buffer.from(original).subarray(part.startByte, part.endByte),
      );
      expect(Buffer.concat([Buffer.from(preamble), ...ranges]).equals(Buffer.from(original))).toBe(
        true,
      );
    }
    expect((await lintRepositoryKnowledge(root)).valid).toBe(true);
    const after = await inspectConfiguredDocumentNormalization({ repositoryRoot: root });
    expect(after.oversizedDocuments).toEqual([]);
    expect(
      (await createDocumentSizeSplitPlan({ repositoryRoot: root, sourcePaths: [] })).status,
    ).toBe("current");
  }, 60_000);
});
