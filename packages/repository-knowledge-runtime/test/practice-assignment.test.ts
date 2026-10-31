import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { listAssignments } from "@lervo/agent-workforce";
import { withPracticeAssignment } from "../src/practice-assignment.js";
import { convergenceDelegationPlanHash } from "../src/delegation.js";
import { fixture } from "./fixture.js";
import { practiceContext } from "./practice-fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

it("keeps older-readable workforce state untouched until schema 8 writer activation", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  const before = await listAssignments(f.root);
  const prepare = vi.fn();
  await expect(
    withPracticeAssignment({
      context: { ...practiceContext(f.root), storage: f.storage },
      role: "generator",
      key: "work",
      paths: [],
      prepare,
      run: async () => null,
    }),
  ).rejects.toThrow("practice_reader_activation_pending");
  expect(prepare).not.toHaveBeenCalled();
  expect(await listAssignments(f.root)).toEqual(before);
});

it("resumes after three pre-call budget waits on the next day without accumulating failures", async () => {
  const f = await fixture(true, false, false, 0, 8);
  fixtures.push(f);
  const { review, ...scope } = f.delegation!;
  const delegation = { ...scope, expiresAt: "2030-01-01T00:00:00Z" };
  await writeFile(
    resolve(f.root, ".lervo/knowledge/convergence-delegation.json"),
    JSON.stringify({
      ...delegation,
      review: { ...review, planHash: convergenceDelegationPlanHash(delegation) },
    }),
  );
  let at = new Date();
  const context = { ...practiceContext(f.root), storage: f.storage, now: () => at };
  const prepare = vi.fn().mockRejectedValue(new Error("practice_budget_exhausted"));
  const run = vi.fn().mockResolvedValue({ practice: null });
  for (let i = 0; i < 3; i++)
    await expect(
      withPracticeAssignment({ context, role: "generator", key: "work", paths: [], prepare, run }),
    ).rejects.toThrow("practice_budget_exhausted");
  expect(await listAssignments(f.root)).toHaveLength(0);
  expect(run).not.toHaveBeenCalled();
  at = new Date(at.getTime() + 86_400_000);
  prepare.mockResolvedValue({ release: async () => {} });
  await expect(
    withPracticeAssignment({ context, role: "generator", key: "work", paths: [], prepare, run }),
  ).resolves.toEqual({ practice: null });
  expect((await listAssignments(f.root)).map((a) => a.status)).toEqual(["completed"]);
});
