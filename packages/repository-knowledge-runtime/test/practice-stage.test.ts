import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runPracticeLearningCycle } from "../src/practice-stage.js";
import { readPracticeState, writePracticeState } from "../src/practice-store.js";
import { practice, practiceContext, work, now } from "./practice-fixture.js";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  drafts: vi.fn(),
  writes: vi.fn(),
  pending: false,
}));
vi.mock("../src/practice-provider.js", () => ({ callPracticeProvider: mocks.call }));
vi.mock("../src/practice-draft.js", () => ({ draftOrReviewPractice: mocks.drafts }));
vi.mock("../src/practice-materialization.js", () => ({ materializePractice: mocks.writes }));
vi.mock("../src/practice-usage.js", () => ({ assessPracticeUsage: async () => {} }));
vi.mock("../src/instruction-capture-queue.js", async (load) => ({
  ...(await load<typeof import("../src/instruction-capture-queue.js")>()),
  listQueuedInstructionCaptures: async () => (mocks.pending ? [{}] : []),
}));
vi.mock("../src/delegation.js", () => ({
  loadConvergenceDelegation: async () => ({ delegation: {} }),
}));
vi.mock("../src/practice-catalog.js", () => ({
  loadPracticeCatalog: async () => ({ readRoots: ["*"] }),
}));
vi.mock("../src/practice-assignment.js", () => ({
  withPracticeAssignment: async (input: { run(authority: unknown): Promise<unknown> }) =>
    input.run({}),
}));
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
beforeEach(() => {
  mocks.call.mockReset();
  mocks.drafts.mockReset();
  mocks.writes.mockReset();
  mocks.pending = false;
});
async function setup(ageMinutes: number) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-practice-stage-"));
  roots.push(root);
  const state = await readPracticeState(root);
  state.works.push({
    ...work,
    observedAt: new Date(now.getTime() - ageMinutes * 60_000).toISOString(),
  });
  await writePracticeState(root, state, now);
  return { root, context: practiceContext(root) };
}
describe("practice-only resident scheduling", () => {
  it("assesses work after thirty minutes without another owner turn", async () => {
    const { root, context } = await setup(30);
    mocks.call.mockResolvedValue({ practice });
    await runPracticeLearningCycle(context, "observe");
    expect(mocks.call).toHaveBeenCalledOnce();
    expect(mocks.call.mock.calls[0]![0].kind).toBe("assessment");
    expect((await readPracticeState(root)).candidates).toHaveLength(1);
    expect(mocks.writes).not.toHaveBeenCalled();
  });
  it("waits before thirty minutes and gives rule capture first admission", async () => {
    const { context } = await setup(29);
    await runPracticeLearningCycle(context, "observe");
    expect(mocks.call).not.toHaveBeenCalled();
    mocks.pending = true;
    await runPracticeLearningCycle(
      { ...context, now: () => new Date(now.getTime() + 60_000) },
      "observe",
    );
    expect(mocks.call).not.toHaveBeenCalled();
  });
  it("records a budget drop without losing the unassessed work", async () => {
    const { root, context } = await setup(31);
    mocks.call.mockRejectedValue(new Error("practice_budget_exhausted"));
    await runPracticeLearningCycle(context, "observe");
    const state = await readPracticeState(root);
    expect(state.works).toHaveLength(1);
    expect(state.funnel[0]!.drops["waiting:practice_budget_exhausted"]).toBe(1);
  });
  it.todo(
    "Hub typed exchange merges candidates from two observing hosts without exchanging work-record text (bounded ADR-0543 exchange follow-up)",
  );
});
