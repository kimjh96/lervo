import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { ConceptSidecarCache } from "@lervo/repository-knowledge";
import { afterEach, expect, it, vi } from "vitest";

import {
  HEALTH_LAYOUT_PLAN_MAXIMUM_AGE_MILLISECONDS,
  healthLayoutPlan,
} from "../src/repository-health-layout.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-health-layout-"));
  roots.push(root);
  return root;
}

const T0 = Date.parse("2026-11-20T00:00:00.000Z");
const plan = (planId: string) => ({ planId }) as never;

it("recomputes the health layout plan only when its inputs change (ADR-0601)", async () => {
  const root = await repository();
  let computed = 0;
  const compute = vi.fn(async (_input: { repositoryRoot: string; conceptCache?: unknown }) =>
    plan(`plan_${++computed}`),
  );
  const first = await healthLayoutPlan({ root, revision: "rev_a", now: new Date(T0), compute });
  expect(compute).toHaveBeenCalledTimes(1);
  // The plan reuses concept decoding across computations.
  expect(compute.mock.calls[0]![0]).toMatchObject({ repositoryRoot: root });
  expect(compute.mock.calls[0]![0].conceptCache).toBeInstanceOf(ConceptSidecarCache);
  expect(await healthLayoutPlan({ root, revision: "rev_a", now: new Date(T0 + 1), compute })).toBe(
    first,
  );
  expect(compute).toHaveBeenCalledTimes(1);
  // A changed repository snapshot recomputes.
  await healthLayoutPlan({ root, revision: "rev_b", now: new Date(T0 + 2), compute });
  expect(compute).toHaveBeenCalledTimes(2);
  // The candidate stores live outside the snapshot, so their change recomputes too.
  await mkdir(resolve(root, ".lervo/state/knowledge/candidates"), { recursive: true });
  await writeFile(resolve(root, ".lervo/state/knowledge/candidates/one.json"), "{}");
  await healthLayoutPlan({ root, revision: "rev_b", now: new Date(T0 + 3), compute });
  expect(compute).toHaveBeenCalledTimes(3);
  await healthLayoutPlan({ root, revision: "rev_b", now: new Date(T0 + 4), compute });
  expect(compute).toHaveBeenCalledTimes(3);
  // The age bound recomputes an unchanged plan within the hour.
  await healthLayoutPlan({
    root,
    revision: "rev_b",
    now: new Date(T0 + 3 + HEALTH_LAYOUT_PLAN_MAXIMUM_AGE_MILLISECONDS),
    compute,
  });
  expect(compute).toHaveBeenCalledTimes(4);
});

it("never remembers a failed plan", async () => {
  const root = await repository();
  const compute = vi.fn(async () => {
    throw new Error("plan failed");
  });
  expect(
    await healthLayoutPlan({ root, revision: "rev_a", now: new Date(T0), compute }),
  ).toBeNull();
  expect(
    await healthLayoutPlan({ root, revision: "rev_a", now: new Date(T0 + 1), compute }),
  ).toBeNull();
  expect(compute).toHaveBeenCalledTimes(2);
});
