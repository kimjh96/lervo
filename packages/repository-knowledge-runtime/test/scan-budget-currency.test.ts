import { readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import {
  defaultRepositoryKnowledgePolicy,
  scanConfiguredRepositoryKnowledge,
  type KnowledgeConvergenceInput,
} from "@lervo/repository-knowledge";
import { afterEach, expect, it } from "vitest";

import { discoverConvergenceBaseline } from "../src/baseline.js";
import { verifyConvergenceLifecycle } from "../src/lifecycle-final.js";
import type { ConvergenceRuntimeContext } from "../src/stage-context.js";
import { fixture } from "./fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

it("refuses both baseline discovery and lifecycle verification after a scan becomes partial", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  const baseline = await discoverConvergenceBaseline(f.root, f.events, f.artifacts);
  const budget =
    (await scanConfiguredRepositoryKnowledge(f.root)).scan.inventoryCoverage.includedBytes + 4096;
  await mkdir(resolve(f.root, "docs/research"), { recursive: true });
  await writeFile(resolve(f.root, "docs/research/overflow.md"), "r".repeat(budget * 2));
  const policyPath = resolve(f.root, ".lervo/knowledge/policy.yaml");
  const previous = JSON.parse(await readFile(policyPath, "utf8"));
  await writeFile(
    policyPath,
    JSON.stringify({
      ...previous,
      limits: { ...defaultRepositoryKnowledgePolicy.limits, maxTotalBytes: budget },
    }),
  );
  const partial = (await scanConfiguredRepositoryKnowledge(f.root)).scan;
  expect(partial.coverage).toBe("partial");
  const state: KnowledgeConvergenceInput = {
    schemaVersion: 1,
    obligationId: "kconv_budgetfixture",
    baseline,
    snapshotHash: baseline.sourceSnapshotHash,
    receipts: [],
    stageData: {},
  };
  const context: ConvergenceRuntimeContext = {
    storage: f.storage,
    provider: "claude",
    signal: new AbortController().signal,
    liveWorkPending: async () => false,
    assertSource() {},
  };
  await expect(discoverConvergenceBaseline(f.root, f.events, f.artifacts)).rejects.toMatchObject({
    code: "knowledge_source_limit_exceeded",
    skippedForBudget: partial.skippedForBudget,
  });
  await expect(verifyConvergenceLifecycle(context, state, () => undefined)).rejects.toMatchObject({
    code: "knowledge_source_limit_exceeded",
    skippedForBudget: partial.skippedForBudget,
  });
  expect(
    JSON.parse(
      await readFile(resolve(f.root, ".lervo/state/knowledge/scan-budget-stop.json"), "utf8"),
    ),
  ).toMatchObject({
    code: "knowledge_source_limit_exceeded",
    skippedForBudget: { classes: ["other_documents"] },
  });
  expect(state.receipts).toEqual([]);
});
