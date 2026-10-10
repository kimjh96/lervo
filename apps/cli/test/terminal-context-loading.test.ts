import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { sha256, type KnowledgeQueryHit } from "@lervo/repository-knowledge";
import { afterEach, describe, expect, it } from "vitest";

import { loadSelectedTerminalDocument } from "../src/terminal-context-loading.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(bytes: Uint8Array = Buffer.from("# 문서\nExact source evidence.\n")) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-context-loading-"));
  roots.push(root);
  await writeFile(resolve(root, "source.md"), bytes);
  return {
    repositoryRoot: root,
    maximumBytes: 1024,
    hit: { path: "source.md", contentHash: sha256(bytes) } as KnowledgeQueryHit,
  };
}

describe("exact terminal loading diagnostics", () => {
  it("preserves full and UTF-8 bounded prefix content", async () => {
    const input = await fixture(Buffer.from("한글 문서".repeat(50)));
    expect(await loadSelectedTerminalDocument(input)).toMatchObject({
      disposition: "loaded",
      scope: "full",
    });
    const partial = await loadSelectedTerminalDocument({ ...input, maximumBytes: 45 });
    expect(partial).toMatchObject({ disposition: "loaded", scope: "prefix" });
    if (partial.disposition === "loaded") {
      expect(Buffer.byteLength(partial.content)).toBeLessThanOrEqual(45);
      expect(partial.content).not.toContain("�");
    }
  });
  it("reports changed and deleted selected sources", async () => {
    const input = await fixture();
    await writeFile(resolve(input.repositoryRoot, "source.md"), "changed");
    expect(await loadSelectedTerminalDocument(input)).toEqual({
      disposition: "unavailable",
      reason: "source_changed",
    });
    await rm(resolve(input.repositoryRoot, "source.md"));
    expect(await loadSelectedTerminalDocument(input)).toEqual({
      disposition: "unavailable",
      reason: "source_unavailable",
    });
  });
  it("separates invalid encoding, oversized sources, and exhausted capacity", async () => {
    expect(await loadSelectedTerminalDocument(await fixture(Buffer.from([0xff])))).toEqual({
      disposition: "unavailable",
      reason: "source_invalid_utf8",
    });
    expect(await loadSelectedTerminalDocument(await fixture(Buffer.alloc(131073)))).toEqual({
      disposition: "unavailable",
      reason: "source_oversized",
    });
    expect(await loadSelectedTerminalDocument({ ...(await fixture()), maximumBytes: 0 })).toEqual({
      disposition: "unavailable",
      reason: "capacity_exhausted",
    });
  });
  it("reports unsafe traversal and symlinks without returning source bytes", async () => {
    const input = await fixture();
    expect(
      await loadSelectedTerminalDocument({
        ...input,
        hit: { ...input.hit, path: "../outside.md" },
      }),
    ).toEqual({ disposition: "unavailable", reason: "source_unsafe" });
    await symlink(
      resolve(input.repositoryRoot, "source.md"),
      resolve(input.repositoryRoot, "link.md"),
    );
    expect(
      await loadSelectedTerminalDocument({ ...input, hit: { ...input.hit, path: "link.md" } }),
    ).toEqual({ disposition: "unavailable", reason: "source_unsafe" });
  });
});
