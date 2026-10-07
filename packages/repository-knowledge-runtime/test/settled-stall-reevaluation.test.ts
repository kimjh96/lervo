import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { canonicalJson } from "@lervo/repository-knowledge";

import { acquireFullCycleAdmission } from "../src/full-cycle-admission.js";
import { createConvergenceRuntimeHost } from "../src/host.js";
import { convergenceEvaluationContract } from "../src/evaluation-contract.js";
import { evaluationFingerprint } from "../src/resident-ownership.js";
import { convergenceManagedKnowledgePath } from "../src/managed-knowledge-scope.js";
import {
  lifecyclePlanParked,
  lifecyclePlanRejection,
  parkedLifecycleCurrencyReasons,
  parkLifecyclePlan,
} from "../src/lifecycle-plan-parking.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { discoverConvergenceBaseline } from "../src/baseline.js";
import { fixture } from "./fixture.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

it("lets the oldest waiter take the next turn and tells the holder others are waiting", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "lervo-fair-admission-"));
  cleanups.push(() =>
    rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }),
  );
  const signal = new AbortController().signal;
  const holder = await acquireFullCycleAdmission({ repositoryRoot: "/repo/a", signal, directory });
  expect(await holder.contended()).toBe(false);
  const order: string[] = [];
  const wait = (repositoryRoot: string) =>
    acquireFullCycleAdmission({ repositoryRoot, signal, directory, pollMilliseconds: 5 }).then(
      async (admission) => {
        order.push(repositoryRoot);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
        await admission.release();
      },
    );
  const first = wait("/repo/b");
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 40));
  const second = wait("/repo/c");
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 40));
  // The installed WSL stall: one long lervo cycle held the slot while five residents waited.
  expect(await holder.contended()).toBe(true);
  await holder.release();
  await Promise.all([first, second]);
  expect(order).toEqual(["/repo/b", "/repo/c"]);
});

it(
  "stops a cycle at the next stage boundary when another repository waits",
  { timeout: 120_000 },
  async () => {
    const f = await fixture(true);
    cleanups.push(async () => {
      await f.storage.close();
      await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    });
    const stages = () =>
      f.events
        .list({ limit: 1_000, types: ["repository.knowledge.stage.recorded"] })
        .filter((event) => event.payload.state !== "queued").length;
    await runAutonomousKnowledgeWorker({
      storage: f.storage,
      workerId: "yield",
      provider: "claude",
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
      shouldYield: async () => true,
    });
    expect(stages()).toBe(1);
  },
);

it("reevaluates a dependency settled by earlier logic once, then keeps the new settlement", async () => {
  const f = await fixture(true);
  cleanups.push(async () => {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });
  const host = createConvergenceRuntimeHost({
    storage: f.storage,
    provider: "claude",
    executable: f.executable,
    admissionDirectory: f.admissionDirectory,
    signal: new AbortController().signal,
    liveWorkPending: async () => false,
    assertSource: () => {},
  });
  expect(host.evaluationContract).toBe(convergenceEvaluationContract());
  const baseline = await discoverConvergenceBaseline(f.root, f.events, f.artifacts);
  const settled = async (dependency: Record<string, unknown>) =>
    (await f.artifacts.put(canonicalJson(dependency))).contentHash;
  const stall = {
    kind: "stage_failure",
    code: "knowledge_stage_failure_unclassified",
    snapshotHash: baseline.sourceSnapshotHash,
    delegationHash: baseline.delegationHash,
    reevaluateAt: new Date(Date.now() + 3_600_000).toISOString(),
  };
  // flemo: settled under adr-0479 with a six-hour reevaluation time.
  expect(
    await host.dependencyCurrent(await settled({ ...stall, evaluationContract: "adr-0479" })),
  ).toBe(false);
  expect(
    await host.dependencyCurrent(
      await settled({ ...stall, evaluationContract: convergenceEvaluationContract() }),
    ),
  ).toBe(true);
  // An uncertain effect keeps its own inspection instead of a blind requeue.
  expect(
    await host.dependencyCurrent(
      await settled({
        kind: "stage_failure",
        code: "knowledge_effect_uncertain",
        snapshotHash: baseline.sourceSnapshotHash,
      }),
    ),
  ).toBe(true);
});

it("runs a full cycle after a new runtime even when no source byte changed", () => {
  const observed = {
    fingerprint: `sha256:${"1".repeat(64)}`,
    sourceDigest: `sha256:${"2".repeat(64)}`,
    earliestAvailableAt: null,
  };
  expect(evaluationFingerprint(observed, "adr-0485:aaaa").fingerprint).not.toBe(
    evaluationFingerprint(observed, "adr-0485:bbbb").fingerprint,
  );
});

it("lets a convergence writer change the layout and lineage a layout plan writes", () => {
  // axli: the reviewer rejected a layout plan whose document-layout and lineage paths were outside
  // every permitted target, although the plan marks them lervo_generated.
  expect(convergenceManagedKnowledgePath(".lervo/knowledge/document-layout.yaml")).toBe(true);
  expect(
    convergenceManagedKnowledgePath(".lervo/knowledge/source-lineage/fc/klineage_fc39.yaml"),
  ).toBe(true);
  expect(convergenceManagedKnowledgePath(".lervo/knowledge/convergence-delegation.json")).toBe(
    false,
  );
  expect(
    convergenceManagedKnowledgePath(".lervo/knowledge/convergence-asset-dispositions.json"),
  ).toBe(false);
});

it("parks a rejected exact lifecycle plan and explains only its pending currency reason", () => {
  const error = Object.assign(new Error("rejected"), {
    code: "knowledge_semantic_review_rejected",
    lifecyclePlanRejection: { planHash: `sha256:${"2".repeat(64)}`, rationale: "Scope missing." },
  });
  const rejection = lifecyclePlanRejection(error)!;
  const parked = parkLifecyclePlan([], "repository_layout", rejection);
  expect(parked).toEqual([
    {
      stage: "lifecycle",
      path: "repository_layout",
      contentHash: rejection.planHash,
      reason: "review_rejected",
      attempts: 1,
      reasons: ["Scope missing."],
    },
  ]);
  expect(lifecyclePlanParked(parked, "repository_layout", rejection.planHash)).toBe(true);
  expect(lifecyclePlanParked(parked, "repository_layout", `sha256:${"3".repeat(64)}`)).toBe(false);
  expect([...parkedLifecycleCurrencyReasons(parked)]).toEqual(["layout_migration_pending"]);
  expect(lifecyclePlanRejection(new Error("other"))).toBeNull();
});
