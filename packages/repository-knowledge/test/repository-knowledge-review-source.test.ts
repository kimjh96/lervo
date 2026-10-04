import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { sha256 } from "../src/integrity.js";
import { knowledgeIntakePolicy } from "../src/knowledge-intake-policy.js";
import {
  captureReviewSources,
  partitionReviewSubJobs,
} from "../src/repository-knowledge-review-source.js";

const intake = knowledgeIntakePolicy();
const reviewSources = async (root: string, manifest: Parameters<typeof captureReviewSources>[1]) =>
  (await captureReviewSources(root, manifest, intake)).sources.map(({ source }) => source);

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

it("skips UTF-8 binary bytes with NUL rather than sending them as text", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-opaque-source-"));
  roots.push(root);
  const bytes = "binary\0payload";
  await writeFile(resolve(root, "asset.bin"), bytes);
  expect(
    await captureReviewSources(
      root,
      { paths: [{ path: "asset.bin", before: null, after: sha256(bytes) }] },
      intake,
    ),
  ).toEqual({ sources: [], skipped: [{ path: "asset.bin", fileDisposition: "skipped_binary" }] });
});

it("skips one oversize file while the rest of the change stays reviewable", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-oversize-source-"));
  roots.push(root);
  const large = "x".repeat(256 * 1024 + 1);
  await writeFile(resolve(root, "large.txt"), large);
  await writeFile(resolve(root, "small.ts"), "export const small = 1;\n");
  const capture = await captureReviewSources(
    root,
    {
      paths: [
        { path: "large.txt", before: null, after: sha256(large) },
        { path: "small.ts", before: null, after: sha256("export const small = 1;\n") },
      ],
    },
    intake,
  );
  expect(capture.skipped).toEqual([{ path: "large.txt", fileDisposition: "skipped_oversize" }]);
  expect(capture.sources.map(({ source }) => source)).toEqual([
    {
      path: "small.ts",
      before: { kind: "missing" },
      after: { kind: "text", text: "export const small = 1;\n" },
    },
  ]);
  // An oversize file still proves currency: changed bytes make the whole unit stale.
  await writeFile(resolve(root, "large.txt"), `${large}y`);
  await expect(
    captureReviewSources(
      root,
      { paths: [{ path: "large.txt", before: null, after: sha256(large) }] },
      intake,
    ),
  ).rejects.toMatchObject({ terminalState: "stale", failureCode: "source_bytes_changed" });
});

it("records generated paths without reading them, by manifest disposition or by policy", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-generated-source-"));
  roots.push(root);
  const capture = await captureReviewSources(
    root,
    {
      paths: [
        { path: ".changes/relint_a.yaml", before: null, after: sha256("a") },
        { path: "apps/cli/release-sbom.cdx.json", before: null, after: sha256("b") },
        { path: "custom/output.txt", before: null, after: sha256("c"), disposition: "generated" },
        { path: "pnpm-lock.yaml", before: null, after: sha256("d") },
      ],
    },
    intake,
  );
  expect(capture).toEqual({
    sources: [],
    skipped: [
      { path: ".changes/relint_a.yaml", fileDisposition: "skipped_generated" },
      { path: "apps/cli/release-sbom.cdx.json", fileDisposition: "skipped_generated" },
      { path: "custom/output.txt", fileDisposition: "skipped_generated" },
      { path: "pnpm-lock.yaml", fileDisposition: "skipped_generated" },
    ],
  });
});

it("splits ordered sub-jobs at 64 paths and at the review byte ceiling", () => {
  const source = (index: number, byteCount: number) => ({
    byteCount,
    source: {
      path: `src/f${String(index).padStart(3, "0")}.ts`,
      before: { kind: "missing" as const },
      after: { kind: "text" as const, text: "" },
    },
  });
  const byCount = partitionReviewSubJobs(
    Array.from({ length: 130 }, (_, index) => source(index, 1)),
  );
  expect(byCount.map((subJob) => subJob.length)).toEqual([64, 64, 2]);
  expect(byCount.flat().map((item) => item.path)).toEqual(
    Array.from({ length: 130 }, (_, index) => `src/f${String(index).padStart(3, "0")}.ts`),
  );
  const byBytes = partitionReviewSubJobs([
    source(0, 200 * 1024),
    source(1, 100 * 1024),
    source(2, 156 * 1024),
  ]);
  expect(byBytes.map((subJob) => subJob.map((item) => item.path))).toEqual([
    ["src/f000.ts"],
    ["src/f001.ts", "src/f002.ts"],
  ]);
});
