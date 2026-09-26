import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import { NormalizationCandidatePreparer } from "../src/conversation-normalization-candidate.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("assigns nothing and starts no provider when no document awaits normalization", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-normalization-prep-"));
  roots.push(root);
  const lines: string[] = [];
  const preparer = new NormalizationCandidatePreparer({
    repositoryRoot: root,
    provider: "codex",
    executables: { codex: resolve(root, "missing-codex") },
    log: (line) => lines.push(line),
  });
  expect(await preparer.review()).toBeNull();
  await preparer.idle();
  expect(lines).toEqual([]);
  await preparer.close();
});
