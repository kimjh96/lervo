import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixture } from "./fixture.js";
import { practice, work } from "./practice-fixture.js";
import { runPracticeLearningCycle } from "../src/practice-stage.js";
import { readPracticeState, writePracticeState } from "../src/practice-store.js";
import { convergenceDelegationPlanHash } from "../src/delegation.js";

const provider = vi.hoisted(() => vi.fn());
vi.mock("../src/practice-provider.js", () => ({ callPracticeProvider: provider }));
const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
const execute = promisify(execFile);
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

describe("standalone resident practice lifecycle", () => {
  it("assesses, drafts, independently reviews and materializes through the integration ref without a Hub", async () => {
    const f = await fixture(true);
    fixtures.push(f);
    const { review: oldReview, ...scope } = f.delegation!;
    const delegation = {
      ...scope,
      normalizationRoots: [...scope.normalizationRoots, ".agents/skills"],
      expiresAt: "2030-01-01T00:00:00Z",
    };
    await writeFile(
      resolve(f.root, ".lervo/knowledge/convergence-delegation.json"),
      JSON.stringify({
        ...delegation,
        review: { ...oldReview, planHash: convergenceDelegationPlanHash(delegation) },
      }),
    );
    const observedNow = new Date();
    const state = await readPracticeState(f.root);
    state.works.push({
      ...work,
      observedAt: new Date(observedNow.getTime() - 31 * 60_000).toISOString(),
    });
    await writePracticeState(f.root, state, observedNow);
    const context = {
      storage: f.storage,
      provider: "claude" as const,
      signal: new AbortController().signal,
      liveWorkPending: async () => false,
      now: () => new Date(),
    };
    provider.mockImplementation(async (input) => {
      if (input.kind === "assessment") return { practice };
      if (input.kind === "draft") return { overlap: "new", targetSkill: null, practice };
      return { ...input.data.binding, decision: "accept", reasonCode: "accepted" };
    });
    for (let cycle = 0; cycle < 4; cycle++) await runPracticeLearningCycle(context, "write");
    const settled = await readPracticeState(f.root);
    expect(settled.candidates[0]!.state).toBe("materialized");
    const candidate = settled.candidates[0]!;
    expect(candidate.review!.reviewerAgentId).not.toBe(candidate.drafterAgentId);
    expect(candidate.review!.reviewerSessionId).not.toBe(candidate.drafterSessionId);
    const path = `.agents/skills/${practice.name}/SKILL.md`;
    const bytes = await readFile(resolve(f.root, path), "utf8");
    expect(
      (await execute("git", ["-C", f.root, "show", `${delegation.integrationTarget.ref}:${path}`]))
        .stdout,
    ).toBe(bytes);
    expect(settled.funnel[0]!.counts.materialized).toBe(1);
    expect(provider).toHaveBeenCalledTimes(3);
  });
});
