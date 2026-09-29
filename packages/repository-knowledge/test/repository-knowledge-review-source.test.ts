import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { sha256 } from "../src/integrity.js";
import { reviewSources } from "../src/repository-knowledge-review-source.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it("recovers an exact pinned before blob beyond four commits and refuses invented dirty history", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-pinned-source-"));
  roots.push(root);
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  git("init", "-b", "main");
  await writeFile(resolve(root, "source.txt"), "Original durable requirement.\n");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@lervo.invalid", "commit", "-m", "original");
  const commit = git("rev-parse", "HEAD");
  for (let index = 0; index < 6; index++) {
    await writeFile(resolve(root, "later.txt"), String(index));
    git("add", ".");
    git(
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@lervo.invalid",
      "commit",
      "-m",
      `later ${index}`,
    );
  }
  await writeFile(resolve(root, "source.txt"), "Current durable requirement.\n");
  const entry = {
    path: "source.txt",
    before: sha256("Original durable requirement.\n"),
    after: sha256("Current durable requirement.\n"),
    beforeCommit: commit,
  };
  expect(await reviewSources(root, { paths: [entry] })).toMatchObject([
    { before: { kind: "text", text: "Original durable requirement.\n" } },
  ]);
  expect(
    await reviewSources(root, {
      paths: [{ ...entry, before: sha256("Uncommitted former bytes.") }],
    }),
  ).toMatchObject([{ before: { kind: "unavailable" } }]);
  expect(await reviewSources(root, { paths: [{ ...entry, beforeCommit: null }] })).toMatchObject([
    { before: { kind: "unavailable" } },
  ]);
});

it("partitions UTF-8 binary bytes with NUL rather than sending them as text", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-opaque-source-"));
  roots.push(root);
  const bytes = "binary\0payload";
  await writeFile(resolve(root, "asset.bin"), bytes);
  expect(
    await reviewSources(root, {
      paths: [{ path: "asset.bin", before: null, after: sha256(bytes) }],
    }),
  ).toMatchObject([{ after: { kind: "opaque", contentHash: sha256(bytes) } }]);
});
