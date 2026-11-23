import { execFileSync } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as workforce from "@lervo/agent-workforce";
import * as orchestrator from "@lervo/orchestrator";
import { RepositoryCoordinationRecords } from "@lervo/project-storage";
import { nextConvergenceIntegrationGeneration } from "../src/integration-target-generation.js";
import {
  CANONICAL_TARGET,
  INTEGRATED_REQUIREMENT,
  canonicalIntegrationFixture,
} from "./canonical-integration-fixture.js";
import { canonicalProviderCalls } from "./canonical-integration-provider.js";

// `reviewKnowledgeJson` is replaced; see `canonicalIntegrationFixture().converge`.
vi.mock("../src/provider-call.js", async () => ({
  reviewKnowledgeJson: (await import("./canonical-integration-provider.js")).canonicalFixtureReview,
}));

const TARGET_REF = "refs/heads/knowledge-integration";
const harnesses: Awaited<ReturnType<typeof canonicalIntegrationFixture>>[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  canonicalProviderCalls.length = 0;
  for (const { f } of harnesses.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

const git = (root: string, ...args: string[]) =>
  execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();

/**
 * Runs lease 1 of the integration assignment until its candidate verification fails, as the
 * observed `pnpm` ENOENT did. `orphan` also refuses that lease's own release, as a lease that
 * stopped first or an earlier release did. Returns the target generations every plan asked for.
 */
async function failFirstVerification(options: { orphan: boolean }) {
  const created = await canonicalIntegrationFixture();
  harnesses.push(created);
  const planned: number[] = [];
  const plan = orchestrator.planWorkspaceIntegrationCandidate;
  vi.spyOn(orchestrator, "planWorkspaceIntegrationCandidate").mockImplementation(async (input) => {
    planned.push(input.targetGeneration);
    return plan(input);
  });
  vi.spyOn(orchestrator, "verifyWorkspaceIntegrationCandidate").mockRejectedValueOnce(
    Object.assign(new Error("spawn pnpm ENOENT"), { code: "ENOENT" }),
  );
  if (options.orphan)
    vi.spyOn(workforce, "releaseWorkspaceIntegrationAttempt").mockRejectedValueOnce(
      new workforce.AgentWorkforceError("workspace_transition_conflict", "Simulated refusal."),
    );
  expect(await created.converge()).toMatchObject({ state: "retry_scheduled" });
  const [first] = await workforce.listWorkspaceIntegrationAttempts(created.f.root);
  expect(first).toMatchObject({ targetGeneration: 1 });
  expect(planned).toEqual([1]);
  return { ...created, planned, first: first! };
}

/** Lets the owner's scheduled retry run; lease 2 is acquired after lease 1's attempt. */
async function retry(converge: () => Promise<unknown>) {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 5 * 60_000);
  return converge();
}

/** The retry integrated generation 2 from the same sealed source and settled the obligation. */
async function expectCompletedRetry(
  f: Awaited<ReturnType<typeof canonicalIntegrationFixture>>["f"],
  first: workforce.WorkspaceIntegrationAttempt,
  status: unknown,
) {
  expect(status).toMatchObject({ state: "idle", outstanding: 0 });
  expect(
    (await workforce.listWorkspaceIntegrationAttempts(f.root))
      .map((attempt) => [attempt.targetGeneration, attempt.state])
      .sort(),
  ).toEqual([
    [1, "released"],
    [2, "integrated"],
  ]);
  expect(await readFile(resolve(f.root, CANONICAL_TARGET), "utf8")).toContain(
    INTEGRATED_REQUIREMENT,
  );
  expect(git(f.root, "show", `${TARGET_REF}:${CANONICAL_TARGET}`)).toContain(
    INTEGRATED_REQUIREMENT,
  );
  expect(
    (await workforce.readWorkspace(f.root, first.sources[0]!.workspaceId))!.workspace.state,
  ).toBe("integrated");
}

/** The state-change reasons recorded for one workspace, oldest first. */
async function workspaceReasons(root: string, workspaceId: string) {
  const records = await RepositoryCoordinationRecords.open(root);
  return (
    await records.list<{
      workspaceId?: string;
      revision: number;
      state: string;
      reasonCode?: string;
    }>("events")
  )
    .map((record) => record.value)
    .filter((event) => event.workspaceId === workspaceId)
    .sort((left, right) => left.revision - right.revision)
    .map((event) => [event.state, event.reasonCode ?? null]);
}

it(
  "releases the attempt whose candidate verification failed, so the retry integrates the next generation",
  { timeout: 60_000 },
  async () => {
    const { f, converge, planned, first } = await failFirstVerification({ orphan: false });
    expect(first.state).toBe("released");
    const records = await RepositoryCoordinationRecords.open(f.root);
    expect(
      (
        await records.list<{
          type: string;
          revision: number;
          previousState?: string;
          state?: string;
        }>("events")
      )
        .map((record) => record.value)
        .filter((event) => event.type === "assignment.integration.state.changed")
        .sort((left, right) => left.revision - right.revision)
        .map((event) => [event.previousState, event.state]),
    ).toEqual([
      ["absent", "leased"],
      ["leased", "candidate"],
      ["candidate", "released"],
    ]);
    // The released attempt's sealed source returned to its queue entry.
    expect((await workspaceReasons(f.root, first.sources[0]!.workspaceId)).slice(-2)).toEqual([
      ["integrating", "integration_candidate_started"],
      ["integration_pending", "integration_attempt_released"],
    ]);
    const status = await retry(converge);
    expect(planned).toEqual([1, 2]);
    await expectCompletedRetry(f, first, status);
  },
);

it(
  "releases an orphaned attempt after its lease ended, so the retry integrates the next generation",
  { timeout: 60_000 },
  async () => {
    const { f, converge, planned, first } = await failFirstVerification({ orphan: true });
    expect(first.state).toBe("candidate");
    expect(git(f.root, "rev-parse", TARGET_REF)).toBe(first.targetBeforeCommit);
    expect(
      (await workforce.readWorkspace(f.root, first.sources[0]!.workspaceId))!.workspace.state,
    ).toBe("integrating");
    const status = await retry(converge);
    expect(planned).toEqual([1, 2]);
    await expectCompletedRetry(f, first, status);
  },
);

/** A commit on top of `parent` that the target ref can move to, as synchronization would. */
function commitOn(root: string, parent: string) {
  return git(root, "commit-tree", `${parent}^{tree}`, "-p", parent, "-m", "Target movement");
}

it(
  "releases an ended attempt after the target moved elsewhere, but not once it holds the candidate",
  { timeout: 60_000 },
  async () => {
    const { f, first } = await failFirstVerification({ orphan: true });
    git(f.root, "update-ref", TARGET_REF, commitOn(f.root, first.candidateCommit!));
    await expect(nextConvergenceIntegrationGeneration(f.root, TARGET_REF)).rejects.toMatchObject({
      code: "knowledge_effect_uncertain",
    });
    expect(
      (await workforce.readWorkspaceIntegrationAttempt(f.root, first.targetLeaseId))!.attempt.state,
    ).toBe("candidate");
    git(f.root, "update-ref", TARGET_REF, commitOn(f.root, first.targetBeforeCommit));
    await expect(nextConvergenceIntegrationGeneration(f.root, TARGET_REF)).resolves.toBe(2);
    expect(
      (await workforce.readWorkspaceIntegrationAttempt(f.root, first.targetLeaseId))!.attempt.state,
    ).toBe("released");
  },
);

it("keeps an ended attempt blocking while it is advancing", { timeout: 60_000 }, async () => {
  const { f, first } = await failFirstVerification({ orphan: true });
  const stored = await workforce.readWorkspaceIntegrationAttempt(f.root, first.targetLeaseId);
  expect(stored!.attempt.state).toBe("candidate");
  const hash = `sha256:${"c".repeat(64)}`;
  await workforce.beginWorkspaceIntegrationAdvancement({
    repositoryRoot: f.root,
    targetLeaseId: first.targetLeaseId,
    expectedContentHash: stored!.contentHash,
    expectedRevision: stored!.attempt.revision,
    eventId: "evt_release_test_advancing",
    occurredAt: new Date().toISOString(),
    verificationReceiptHash: hash,
    verificationResults: [
      {
        suiteId: "project.quick",
        suiteHash: hash,
        verificationId: "ver_release_test_01",
        resultArtifactId: "art_release_test_01",
        resultContentHash: hash,
      },
    ],
  });
  await expect(nextConvergenceIntegrationGeneration(f.root, TARGET_REF)).rejects.toMatchObject({
    code: "knowledge_effect_uncertain",
  });
  expect(
    (await workforce.readWorkspaceIntegrationAttempt(f.root, first.targetLeaseId))!.attempt.state,
  ).toBe("advancing");
});

it(
  "requeues a stage an earlier version stalled on an orphaned attempt, then integrates the next generation",
  { timeout: 90_000 },
  async () => {
    const { f, cycle, converge, planned, first } = await failFirstVerification({ orphan: true });
    // The earlier version could not release, so lease 2 stopped at the generation fence.
    const refusal = vi
      .spyOn(workforce, "releaseWorkspaceIntegrationAttempt")
      .mockRejectedValue(
        new workforce.AgentWorkforceError("workspace_transition_conflict", "Earlier version."),
      );
    expect(await retry(converge)).toMatchObject({
      state: "recovery_required",
      reason: "knowledge_effect_uncertain",
    });
    expect(planned).toEqual([1]);
    const stalled = f.events
      .list({ limit: 1000 })
      .findLast((event) => event.type === "repository.knowledge.stage.recorded")!;
    expect(stalled.payload).toMatchObject({
      stage: "canonical_integration",
      state: "recovery_required",
    });
    expect(
      (await workforce.readWorkspaceIntegrationAttempt(f.root, first.targetLeaseId))!.attempt.state,
    ).toBe("candidate");

    // The fixed version's owner inspects the stall: it releases the orphan and requeues the stage.
    refusal.mockRestore();
    vi.setSystemTime(Date.now() + 5 * 60_000);
    await cycle();
    expect(
      (await workforce.readWorkspaceIntegrationAttempt(f.root, first.targetLeaseId))!.attempt.state,
    ).toBe("released");
    expect(
      f.events
        .list({ afterSeq: stalled.seq, limit: 1000 })
        .find((event) => event.type === "repository.knowledge.stage.recorded")!.payload,
    ).toMatchObject({ stage: "canonical_integration", state: "queued" });
    const status = await converge();
    expect(planned).toEqual([1, 2]);
    await expectCompletedRetry(f, first, status);
  },
);
