import { rm, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { fixture } from "./fixture.js";
import {
  createConvergenceDelegationPlan,
  applyConvergenceDelegationPlan,
} from "../src/delegation-plan.js";
import { convergenceDelegationPlanHash, CONVERGENCE_DELEGATION_PATH } from "../src/delegation.js";
const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

it("plans revocation without changing authority, then durably applies the exact reviewed plan", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  const { review, ...old } = f.delegation!;
  const body = { ...old, state: "revoked" as const };
  const reviewed = {
    ...body,
    review: { ...review, planHash: convergenceDelegationPlanHash(body) },
  };
  const path = resolve(f.root, CONVERGENCE_DELEGATION_PATH);
  const before = await readFile(path, "utf8");
  const plan = await createConvergenceDelegationPlan(f.storage, reviewed);
  expect(await readFile(path, "utf8")).toBe(before);
  await applyConvergenceDelegationPlan(f.storage, plan);
  expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
    state: "revoked",
    review: { planHash: reviewed.review.planHash },
  });
  expect(
    f.events
      .list({ limit: 100 })
      .filter((event) => event.type === "knowledge.materialization.applied"),
  ).toHaveLength(1);
});

it("rejects a changed review or concurrently replaced authority without overwriting bytes", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  await expect(
    createConvergenceDelegationPlan(f.storage, {
      ...f.delegation,
      review: { ...f.delegation!.review, planHash: `sha256:${"0".repeat(64)}` },
    }),
  ).rejects.toMatchObject({ code: "knowledge_authority_unavailable" });
  const plan = await createConvergenceDelegationPlan(f.storage, f.delegation);
  const path = resolve(f.root, CONVERGENCE_DELEGATION_PATH);
  const changed = `${JSON.stringify(f.delegation, null, 2)}\n`;
  await writeFile(path, changed);
  await expect(applyConvergenceDelegationPlan(f.storage, plan)).rejects.toMatchObject({
    code: "knowledge_plan_stale",
  });
  expect(await readFile(path, "utf8")).toBe(changed);
});
