import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it } from "vitest";

import { readCasRetentionAttention } from "../src/cas-retention-attention.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function observed(observation: Record<string, unknown> | null): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lervo-cas-attention-"));
  roots.push(root);
  if (observation !== null) {
    await mkdir(join(root, ".lervo/state/knowledge"), { recursive: true });
    await writeFile(
      join(root, ".lervo/state/knowledge/cas-retention-observation.json"),
      JSON.stringify({ schemaVersion: 1, removedObjects: 0, reclaimedBytes: 0, ...observation }),
    );
  }
  return root;
}

it("names the path that stops retention and how the owner frees it (ADR-0658)", async () => {
  const issues = await readCasRetentionAttention(
    await observed({
      status: "unavailable",
      failure: "unreadable_reference",
      reference: ".lervo/data/repository-coordination-v1",
    }),
  );
  expect(issues).toEqual([
    {
      code: "cas_retention_unreadable_reference",
      command: expect.stringContaining(
        'sudo chown -R "$USER" .lervo/data/repository-coordination-v1',
      ),
      detail: ".lervo/data/repository-coordination-v1",
    },
  ]);
});

it("reports an anonymous stop and a file that keeps changing, but not a working pass", async () => {
  expect(
    await readCasRetentionAttention(await observed({ status: "unavailable", failure: "failed" })),
  ).toEqual([{ code: "cas_retention_failed", command: expect.stringContaining("lervo doctor") }]);
  expect(
    await readCasRetentionAttention(
      await observed({ status: "yielded", failure: "unstable_reference", reference: "a.json" }),
    ),
  ).toMatchObject([{ code: "cas_retention_unstable_reference", detail: "a.json" }]);
  for (const observation of [
    { status: "collected", failure: null },
    { status: "yielded", failure: null },
    null,
  ])
    expect(await readCasRetentionAttention(await observed(observation))).toEqual([]);
});
