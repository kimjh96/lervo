import { rm } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import { canonicalJson, type KnowledgeConvergenceInput } from "@lervo/repository-knowledge";

import { assertConvergenceSourceCurrent, assertConvergenceSourceExact } from "../src/host.js";
import { appendPracticeEvent } from "../src/practice-events.js";
import { captureConvergenceSources } from "../src/source-capture.js";
import type { ConvergenceSourceObservation } from "../src/source-observation.js";
import type { ConvergenceRuntimeContext } from "../src/stage-context.js";
import { durableEffectState, durableStateChanges } from "./durable-effect-state.js";
import { sweepSourceFences, type Fixture } from "./effect-fence-sweep.js";
import { fixture } from "./fixture.js";

// The sweep's own failure modes: each test hands it a worker that misbehaves on purpose.
// Every refusal is recorded where it is raised, so the sweep can tell which fence refused.
vi.mock("../src/failure.js", async (load) =>
  (await import("./fence-refusal-recorder.js")).recordingFailureModule(
    await load<typeof import("../src/failure.js")>(),
  ),
);

const fixtures: Fixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

async function boundState() {
  // Schema version 8 admits the practice event the misbehaving worker appends.
  const f = await fixture(false, false, false, 0, 8);
  fixtures.push(f);
  const state = {
    obligationId: "kconv_harness",
    snapshotHash: captureConvergenceSources(f.root, "sha256:policy").snapshotHash,
    receipts: [],
    stageData: {},
    baseline: { policyHash: "sha256:policy" },
  } as unknown as KnowledgeConvergenceInput;
  const context = (observation: ConvergenceSourceObservation) =>
    ({
      storage: f.storage,
      signal: new AbortController().signal,
      sourceObservation: observation,
    }) as unknown as ConvergenceRuntimeContext;
  return { f, state, context };
}

const sweep = (f: Fixture, run: (observation: ConvergenceSourceObservation) => Promise<unknown>) =>
  sweepSourceFences({
    f,
    mutatedPath: "README.md",
    cycles: 1,
    at: "exact",
    inject: () => true,
    done: async () => true,
    run,
  });

it("observes artifacts in the content store", async () => {
  const { f } = await boundState();
  const before = durableEffectState(f.root, "README.md");
  await f.artifacts.put(canonicalJson({ kind: "convergence_asset_settlement", assets: [] }));
  expect(durableStateChanges(before, durableEffectState(f.root, "README.md"))).toEqual([
    expect.stringMatching(/^artifacts: \+\["convergence_asset_settlement:/u),
  ]);
});

it("fails an event appended after an exact fence refused", async () => {
  const { f, state, context } = await boundState();
  const result = await sweep(f, async (observation) => {
    try {
      assertConvergenceSourceExact(context(observation), state);
    } catch (error) {
      appendPracticeEvent(f.storage, "knowledge.skill.retired", {
        skillName: "harness",
        versionHash: `sha256:${"0".repeat(64)}`,
        retirementCommit: "0".repeat(40),
        occurredAt: new Date().toISOString(),
      });
      throw error;
    }
  });
  expect(result.violations).toContainEqual(
    expect.stringContaining("event knowledge.skill.retired after the refusing fence"),
  );
});

it("credits no exact fence with a refusal a later decision check raised", async () => {
  const { f, state, context } = await boundState();
  const result = await sweep(f, async (observation) => {
    // The exact capture sees the edit but nothing compares it; a decision check refuses later.
    observation.exact("sha256:policy");
    assertConvergenceSourceCurrent(context(observation), state);
  });
  expect(result.violations).toContainEqual(expect.stringContaining("no refusal by this fence"));
});
