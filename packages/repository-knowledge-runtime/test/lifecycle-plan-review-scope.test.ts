import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { KnowledgeConvergenceInput } from "@lervo/repository-knowledge";

import { discoverConvergenceBaseline } from "../src/baseline.js";
import { reviewLifecyclePlan } from "../src/lifecycle-plan-review.js";
import type { ConvergenceRuntimeContext } from "../src/stage-context.js";
import { fixture } from "./fixture.js";

const reviewed: { plan?: unknown; sources: { path: string }[] }[] = [];

vi.mock("../src/provider-call.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/provider-call.js")>();
  return {
    ...actual,
    reviewKnowledgeJson: async (input: Parameters<typeof actual.reviewKnowledgeJson>[0]) => {
      const data = input.untrustedSourceData as {
        planHash: string;
        sources: { path: string }[];
      };
      reviewed.push({ plan: (data as { plan?: unknown }).plan, sources: data.sources });
      return {
        value: {
          planHash: data.planHash,
          decision: "approve",
          rationale:
            "The exact lifecycle plan preserves every changed document's meaning, links and user-owned regions.",
        },
        usage: { status: "unavailable", reason: "fixture" },
        admissionObservationHash: `sha256:${"0".repeat(64)}`,
        observationArtifactHash: `sha256:${"0".repeat(64)}`,
      };
    },
  };
});

// The assignment boundary has its own suites; this test isolates what the reviewer is shown.
vi.mock("../src/workforce.js", () => ({
  withConvergenceAssignment: async (input: { run: (authority: unknown) => Promise<unknown> }) =>
    input.run({
      agent: { agentId: "agt_lifecycle_reviewer" },
      delegation: {
        resourceCeilings: { maximumProviderCalls: 8 },
        canonicalRoots: ["docs/specs"],
        normalizationRoots: ["docs/specs"],
      },
    }),
}));

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  reviewed.splice(0);
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

it("reviews a lifecycle plan with its own paths, not every repository source", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  // The installed axli stop: about 2 MB of uncommitted code, lock, and CAD text made every
  // lifecycle plan review exceed its 1 MiB request bound before any reviewer saw the plan.
  await mkdir(resolve(f.root, "services/worker"), { recursive: true });
  for (let index = 0; index < 8; index++)
    await writeFile(
      resolve(f.root, `services/worker/module-${index}.py`),
      `${"value = 'exact repository code that no lifecycle plan changes'\n".repeat(3_500)}`,
    );
  const baseline = await discoverConvergenceBaseline(f.root, f.events, f.artifacts);
  const state: KnowledgeConvergenceInput = {
    schemaVersion: 1,
    obligationId: "kconv_lifecycle_scope",
    baseline,
    snapshotHash: baseline.sourceSnapshotHash,
    receipts: [],
    stageData: {},
  };
  expect(
    baseline.sources.filter((source) => source.path.startsWith("services/worker/")),
  ).toHaveLength(8);
  const context: ConvergenceRuntimeContext = {
    storage: f.storage,
    provider: "claude",
    executable: f.executable,
    admissionDirectory: f.admissionDirectory,
    signal: new AbortController().signal,
    liveWorkPending: async () => false,
    assertSource() {},
  };
  const approval = await reviewLifecyclePlan(
    context,
    state,
    () => {},
    { planId: "klayout_scope", operations: [{ path: "docs/specs/runtime.md" }] },
    ["docs/specs/runtime.md"],
  );
  expect(approval.planHash).toMatch(/^sha256:/u);
  expect(reviewed.map((review) => review.sources.map((source) => source.path))).toEqual([
    ["docs/specs/runtime.md"],
  ]);
});

it("binds a stale multi-megabyte generated projection by hash instead of disclosing its bytes", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  // The installed axli stop after ADR-0479: the plan rewrites the private knowledge inventory,
  // whose stale 4.86 MB bytes were disclosed as a reviewed source.
  const inventory = ".lervo/state/knowledge/current/inventory.json";
  await mkdir(resolve(f.root, ".lervo/state/knowledge/current"), { recursive: true });
  await writeFile(
    resolve(f.root, inventory),
    JSON.stringify({
      sources: Array.from({ length: 40_000 }, (_, index) => `path-${index}`.repeat(10)),
    }),
  );
  const baseline = await discoverConvergenceBaseline(f.root, f.events, f.artifacts);
  const state: KnowledgeConvergenceInput = {
    schemaVersion: 1,
    obligationId: "kconv_generated_projection",
    baseline,
    snapshotHash: baseline.sourceSnapshotHash,
    receipts: [],
    stageData: {},
  };
  const context: ConvergenceRuntimeContext = {
    storage: f.storage,
    provider: "claude",
    executable: f.executable,
    admissionDirectory: f.admissionDirectory,
    signal: new AbortController().signal,
    liveWorkPending: async () => false,
    assertSource() {},
  };
  const plan = {
    planId: "klayout_generated",
    operations: [
      {
        path: inventory,
        action: "update",
        ownership: "lervo_generated",
        content: '{"sources":[]}\n',
        desiredHash: `sha256:${"1".repeat(64)}`,
      },
      {
        path: "docs/specs/runtime.md",
        action: "update",
        ownership: "user",
        content: "# Runtime\n\nThe runtime works locally without a Hub.\n",
        desiredHash: `sha256:${"2".repeat(64)}`,
      },
    ],
  };
  const approval = await reviewLifecyclePlan(context, state, () => {}, plan, [
    inventory,
    "docs/specs/runtime.md",
  ]);
  expect(approval.planHash).toMatch(/^sha256:/u);
  const [review] = reviewed as unknown as {
    plan: { operations: Record<string, unknown>[] };
    sources: { path: string; content: string | null; contentHash: string | null }[];
  }[];
  expect(review!.sources).toEqual([
    {
      path: inventory,
      contentHash: expect.stringMatching(/^sha256:/u),
      ownership: "lervo_generated",
      content: null,
    },
    expect.objectContaining({ path: "docs/specs/runtime.md", content: expect.any(String) }),
  ]);
  expect(review!.plan.operations[0]).not.toHaveProperty("content");
  expect(review!.plan.operations[0]).toMatchObject({ contentDisclosed: false });
  expect(review!.plan.operations[1]).toHaveProperty("content");
});
