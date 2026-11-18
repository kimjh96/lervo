import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  documentFreshnessAttentionSources,
  inspectDocumentFreshnessStatus,
  listDocumentFreshnessReview,
  renderDocumentFreshnessDiff,
} from "../src/freshness-review.js";
import { runDocumentFreshnessCycle } from "../src/freshness-stage.js";
import {
  listFreshnessCandidates,
  readFreshnessCycleState,
  writeFreshnessCycleState,
} from "../src/freshness-state-store.js";
import {
  freshnessFixture,
  type FreshnessFixture,
  type FreshnessPlanEntry,
} from "./freshness-fixture.js";

const fixtures: FreshnessFixture[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

const agents = (routes: string, guide: string) =>
  [
    "# Repository instructions",
    "",
    "Keep runtime requirements and user-owned content unchanged.",
    "",
    "<!-- lervo:begin block=routes schema=1 -->",
    routes,
    "<!-- lervo:end block=routes -->",
    "",
    guide,
    "",
  ].join("\n");

const MANAGED_BEFORE = "Generated routes are listed in `docs/old/routes.md`.";
const MANAGED_AFTER = "The route table now sits in `docs/routes.md`.";
const PROSE_BEFORE = "The build guide lives in `ops/old-build.md`.";
const PROSE_AFTER = "The build guide lives in `ops/build.md`.";
const ORIGINAL = agents(MANAGED_BEFORE, PROSE_BEFORE);

/**
 * `AGENTS.md` with a Lervo-managed `statement` hunk inside a `lervo_v1` block and a user-owned
 * `factual_reference` hunk in prose. The reviewer judges both, but Lervo applies only the managed
 * hunk; the prose hunk stays a suggestion (ADR-0561, AGENTS.md invariant 5).
 */
async function setup(crossCheck: Partial<FreshnessPlanEntry> = {}) {
  const f = await freshnessFixture();
  fixtures.push(f);
  await f.write("docs/old/routes.md", "# Routes\n\nThe generated route table.\n");
  await f.write("ops/old-build.md", "# Build\n\nThe build guide.\n");
  await f.write("AGENTS.md", ORIGINAL);
  await f.commit("add routes and build guide");
  await f.git(["mv", "docs/old/routes.md", "docs/routes.md"]);
  await f.git(["mv", "ops/old-build.md", "ops/build.md"]);
  await f.commit("move routes and build guide");
  await plan(f, crossCheck);
  return f;
}

async function plan(f: FreshnessFixture, crossCheck: Partial<FreshnessPlanEntry>) {
  await f.plan({
    "AGENTS.md": {
      operation: "edit",
      hunks: [
        { before: MANAGED_BEFORE, after: MANAGED_AFTER, evidencePaths: ["docs/routes.md"] },
        { before: PROSE_BEFORE, after: PROSE_AFTER, evidencePaths: ["ops/build.md"] },
      ],
      ...crossCheck,
    },
  });
}

function usageRecords(f: FreshnessFixture) {
  return f
    .eventsOf("resource.usage.recorded")
    .map((event) => event.payload as Record<string, unknown>)
    .filter((payload) => payload.stage === "document_freshness");
}

const minutes = (count: number) => new Date(Date.now() + count * 60_000);

describe("document freshness Tier 0 cross-check (ADR-0557)", () => {
  it(
    "applies the agreed Lervo-managed hunk, keeps the user-owned hunk a suggestion, and commits the notice",
    { timeout: 120_000 },
    async () => {
      const f = await setup();
      const result = await f.cycle();
      expect(result).toMatchObject({ status: "completed", candidateCount: 1, appliedCount: 1 });
      expect((await f.providerCalls()).map((call) => call.task)).toEqual([
        "document_freshness_candidate",
        "document_freshness_cross_check",
      ]);
      const [candidate] = await listFreshnessCandidates(f.root);
      const [managed, prose] = candidate!.hunks;
      expect(managed).toMatchObject({
        changeClass: "statement",
        ownership: "lervo_managed",
        authorityRequired: "none",
        crossCheckRequired: true,
      });
      expect(prose).toMatchObject({
        ownership: "user_owned",
        authorityRequired: "none",
        crossCheckRequired: true,
      });
      expect(candidate).toMatchObject({
        state: "partially_applied",
        crossCheck: "agreement",
        authorityRequired: "none",
        appliedHunkIds: [managed!.hunkId],
        pendingHunkIds: [prose!.hunkId],
        crossCheckReview: { status: "settled", outcome: "agreement", reviewerProvider: "claude" },
      });
      expect(candidate!.crossCheckReview!.verdicts.map((verdict) => verdict.verdict)).toEqual([
        "agree",
        "agree",
      ]);
      expect(await f.read("AGENTS.md")).toBe(agents(MANAGED_AFTER, PROSE_BEFORE));
      expect(f.eventsOf("document.freshness.candidate.applied")[0]?.payload).toMatchObject({
        approvalSource: "lervo_managed",
        appliedHunkCount: 1,
        pendingHunkCount: 1,
      });
      // ADR-0561 notice fields travel with the commit, so every host reads the same notice.
      const log = await f.git(["log", "-1", "--format=%B"]);
      expect(log).toContain(`Lervo-Freshness-Candidate: ${candidate!.candidateId}`);
      expect(log).toMatch(/^Lervo-Freshness-Reason: [a-z_, ]+$/mu);
      expect(log).toContain(
        `Lervo-Freshness-Cross-Check: agreement 1/1 (claude ${candidate!.crossCheckReview!.runId})`,
      );

      const verified = f.eventsOf("document.freshness.candidate.verified");
      expect(verified).toHaveLength(1);
      expect(verified[0]!.payload).toMatchObject({
        crossCheck: "agreement",
        authorityRequired: "none",
        deliberationRunId: candidate!.crossCheckReview!.runId,
      });
      expect(candidate!.crossCheckReview!.runId).toMatch(/^run_freshness_[a-f0-9]{24}$/u);
      expect(JSON.stringify(verified[0]!.payload)).not.toContain("cited evidence");

      // Generation and cross-check run as separate calls, each with its own usage record, and the
      // cross-check tokens count inside the candidate and the daily budget.
      const usage = usageRecords(f);
      expect(usage).toHaveLength(2);
      expect(candidate!.tokensObserved).toBe(3_000);
      expect(f.eventsOf("document.freshness.cycle.completed").at(-1)?.payload.usageObserved).toBe(
        3_000,
      );
      expect((await inspectDocumentFreshnessStatus(f.root, new Date())).budget.tokensUsed).toBe(
        3_000,
      );

      const diff = await renderDocumentFreshnessDiff(f.storage, candidate!);
      expect(diff).toContain(`@@ ${prose!.hunkId}`);
      expect(diff).toContain("cross-check-agree @@");
      expect(diff).toContain("# cross-check agree: The cited evidence shows");
    },
  );

  it(
    "rejects a disagreed candidate with its contested hunks, never queues it, and regenerates once",
    { timeout: 120_000 },
    async () => {
      const f = await setup({ crossCheck: "disagree", crossCheckDisagree: [MANAGED_BEFORE] });
      await f.cycle(minutes(1));
      const [rejected] = await listFreshnessCandidates(f.root);
      const managedId = rejected!.hunks[0]!.hunkId;
      expect(rejected).toMatchObject({
        state: "rejected",
        crossCheck: "material_disagreement",
        rejection: {
          reasonCode: "cross_check_disagreement",
          rejectorKind: "cross_check",
          contestedHunkIds: [managedId],
        },
      });
      expect(f.eventsOf("document.freshness.candidate.rejected")[0]?.payload).toMatchObject({
        reasonCode: "cross_check_disagreement",
        rejectorKind: "cross_check",
        contestedHunkIds: [managedId],
      });
      expect(f.eventsOf("document.freshness.candidate.verified")).toHaveLength(0);
      expect(await f.read("AGENTS.md")).toBe(ORIGINAL);
      expect(await listDocumentFreshnessReview(f.root)).toEqual([]);
      expect((await documentFreshnessAttentionSources(f.root, new Date())).held).toEqual([]);

      await plan(f, {});
      const regenerated = await f.cycle(minutes(2));
      expect(regenerated).toMatchObject({ status: "completed", candidateCount: 1 });
      const next = (await listFreshnessCandidates(f.root)).find(
        (candidate) => candidate.candidateId !== rejected!.candidateId,
      );
      expect(next).toMatchObject({
        state: "partially_applied",
        crossCheck: "agreement",
        predecessorCandidateId: rejected!.candidateId,
      });
      // The regeneration carried the reviewer's disagreement as evidence.
      expect(
        (await f.providerCalls())
          .filter((call) => call.task === "document_freshness_candidate")
          .map((call) => call.regeneration),
      ).toEqual([null, "cross_check_disagreement"]);
      expect((await documentFreshnessAttentionSources(f.root, new Date())).debt).toEqual([]);
    },
  );

  it(
    "holds the finding as Lervo debt with backoff after the regeneration also meets disagreement",
    { timeout: 120_000 },
    async () => {
      const f = await setup({ crossCheck: "disagree" });
      await f.cycle(minutes(1));
      await f.cycle(minutes(2));
      const candidates = await listFreshnessCandidates(f.root);
      expect(candidates.map((candidate) => candidate.rejection?.reasonCode)).toEqual([
        "cross_check_disagreement",
        "cross_check_disagreement",
      ]);
      const calls = (await f.providerCalls()).length;
      expect(calls).toBe(4);
      const attention = await documentFreshnessAttentionSources(f.root, new Date());
      expect(attention.debt).toEqual([
        expect.objectContaining({
          documentPath: "AGENTS.md",
          reason: "cross_check_disagreement_repeated",
          attempts: 1,
        }),
      ]);
      expect(attention.held).toEqual([]);
      const retryAt = Date.parse(attention.debt[0]!.retryAt);
      expect(retryAt - Date.parse(attention.debt[0]!.since)).toBe(86_400_000);
      // Within the backoff nothing is spent; after it, one retry runs and doubles the backoff.
      await f.cycle(minutes(3));
      expect(await f.providerCalls()).toHaveLength(calls);
      expect(await f.read("AGENTS.md")).toBe(ORIGINAL);
      // The scratch delegation lasts less than a day, so the elapsed backoff is rewound instead.
      const state = await readFreshnessCycleState(f.root);
      await writeFreshnessCycleState(f.root, {
        ...state,
        debt: state.debt!.map((entry) => ({ ...entry, retryAt: minutes(3).toISOString() })),
      });
      const retried = minutes(4);
      await f.cycle(retried);
      expect(await f.providerCalls()).toHaveLength(calls + 2);
      const [debt] = (await documentFreshnessAttentionSources(f.root, new Date())).debt;
      expect(debt).toMatchObject({ reason: "cross_check_disagreement_repeated", attempts: 2 });
      expect(Date.parse(debt!.retryAt) - retried.getTime()).toBe(2 * 86_400_000);
    },
  );

  for (const [mode, reason] of [
    ["invalid", "cross_check_response_invalid"],
    ["fail", "cross_check_provider_failed"],
  ] as const)
    it(
      `holds every required hunk as Lervo's own retry when the cross-check is ${mode}, never agreeing`,
      { timeout: 120_000 },
      async () => {
        const f = await setup({ crossCheck: mode });
        await f.cycle(minutes(1));
        const [candidate] = await listFreshnessCandidates(f.root);
        expect(candidate).toMatchObject({
          state: "verified_pending_cross_check",
          crossCheck: "unavailable",
          authorityRequired: "none",
          appliedHunkIds: [],
          crossCheckReview: { status: "settled", unavailableReason: reason, verdicts: [] },
        });
        expect(await f.read("AGENTS.md")).toBe(ORIGINAL);
        expect(f.eventsOf("document.freshness.candidate.applied")).toHaveLength(0);
        expect(f.eventsOf("document.freshness.candidate.verified")[0]?.payload).toMatchObject({
          crossCheck: "unavailable",
          deliberationRunId: candidate!.crossCheckReview!.runId,
        });
        const [held] = await listDocumentFreshnessReview(f.root);
        expect(held!.retryAt).toBe(
          new Date(Date.parse(candidate!.crossCheckReview!.settledAt!) + 3_600_000).toISOString(),
        );
        // Lervo retries the call itself after the backoff; nothing waits for the owner.
        await plan(f, {});
        await f.cycle(minutes(1 + 61));
        const all = await listFreshnessCandidates(f.root);
        const retried = all.find((item) => item.candidateId === candidate!.candidateId);
        if (mode === "invalid") {
          expect(retried).toMatchObject({
            candidateId: candidate!.candidateId,
            state: "partially_applied",
            crossCheck: "agreement",
            crossCheckReview: { retries: 1 },
          });
          expect(await f.read("AGENTS.md")).toBe(agents(MANAGED_AFTER, PROSE_BEFORE));
          expect(f.eventsOf("document.freshness.candidate.verified")).toHaveLength(2);
        } else {
          // A failed call may have reached the model, so it was charged the remaining bound and
          expect(candidate!.tokensObserved).toBe(30_000);
          // the retry cannot fit: the candidate is rejected, and a fresh candidate with its own
          // budget regenerates and applies.
          expect(retried).toMatchObject({
            state: "rejected",
            rejection: { reasonCode: "freshness_budget_exhausted", rejectorKind: "budget" },
          });
          expect(all.find((item) => item.candidateId !== candidate!.candidateId)).toMatchObject({
            state: "partially_applied",
          });
          expect(await f.read("AGENTS.md")).toBe(agents(MANAGED_AFTER, PROSE_BEFORE));
        }
      },
    );

  it(
    "rejects a cross-check that would exceed the candidate budget and holds the finding as debt",
    { timeout: 120_000 },
    async () => {
      const f = await setup({ crossCheckInputTokens: 29_000 });
      await f.cycle();
      const [candidate] = await listFreshnessCandidates(f.root);
      expect(candidate).toMatchObject({
        state: "rejected",
        crossCheck: "unavailable",
        rejection: { reasonCode: "freshness_budget_exhausted", rejectorKind: "budget" },
        crossCheckReview: { unavailableReason: "freshness_budget_exhausted" },
        tokensObserved: 1_500 + 29_300,
      });
      expect((await inspectDocumentFreshnessStatus(f.root, new Date())).budget.tokensUsed).toBe(
        30_800,
      );
      expect((await inspectDocumentFreshnessStatus(f.root, new Date())).debt).toEqual([
        expect.objectContaining({ documentPath: "AGENTS.md", reason: "budget_exceeded" }),
      ]);
      expect(await f.read("AGENTS.md")).toBe(ORIGINAL);
    },
  );

  it(
    "charges a cross-check that reached the provider before its usage limit",
    { timeout: 120_000 },
    async () => {
      const f = await setup({ crossCheck: "quota" });
      await f.cycle();
      const [candidate] = await listFreshnessCandidates(f.root);
      expect(candidate).toMatchObject({
        state: "verified_pending_cross_check",
        crossCheck: "unavailable",
        crossCheckReview: { unavailableReason: "knowledge_provider_paused" },
      });
      // The failed call is charged whatever was left of the 30,000-token candidate budget.
      expect(candidate!.tokensObserved).toBe(30_000);
      expect(await f.read("AGENTS.md")).toBe(ORIGINAL);
    },
  );

  it(
    "waits for the daily budget without spending or counting a deferral",
    { timeout: 120_000 },
    async () => {
      const f = await setup();
      const turn = (now: Date) =>
        runDocumentFreshnessCycle({
          context: {
            storage: f.storage,
            provider: "claude",
            executable: f.executable,
            admissionDirectory: f.admissionDirectory,
            signal: new AbortController().signal,
            liveWorkPending: async () => false,
            now: () => now,
            providerQuantum: { remaining: 1 },
          },
        });
      await turn(minutes(1));
      const [pending] = await listFreshnessCandidates(f.root);
      expect(pending).toMatchObject({ crossCheckReview: { status: "pending", deferrals: 1 } });
      const state = await readFreshnessCycleState(f.root);
      await writeFreshnessCycleState(f.root, {
        ...state,
        // Enough for the estimated input, but not for the remaining-candidate charge bound.
        budget: { ...state.budget, tokensUsed: 150_000 - 5_000 },
      });
      await turn(minutes(2));
      const [waiting] = await listFreshnessCandidates(f.root);
      expect(waiting).toMatchObject({
        state: "generated",
        crossCheckReview: { status: "pending", deferrals: 1 },
      });
      expect((await f.providerCalls()).map((call) => call.task)).toEqual([
        "document_freshness_candidate",
      ]);
    },
  );

  it(
    "keeps the cross-check pending across a turn without provider capacity, then applies it",
    { timeout: 120_000 },
    async () => {
      const f = await setup();
      const turn = (now: Date) =>
        runDocumentFreshnessCycle({
          context: {
            storage: f.storage,
            provider: "claude",
            executable: f.executable,
            admissionDirectory: f.admissionDirectory,
            signal: new AbortController().signal,
            liveWorkPending: async () => false,
            now: () => now,
            providerQuantum: { remaining: 1 },
          },
        });
      await turn(minutes(1));
      const [pending] = await listFreshnessCandidates(f.root);
      expect(pending).toMatchObject({
        state: "generated",
        crossCheckReview: { status: "pending", deferrals: 1 },
      });
      expect(await listDocumentFreshnessReview(f.root)).toEqual([]);
      expect(f.eventsOf("document.freshness.candidate.verified")).toHaveLength(0);
      expect(await f.read("AGENTS.md")).toBe(ORIGINAL);

      await turn(minutes(2));
      const [settled] = await listFreshnessCandidates(f.root);
      expect(settled).toMatchObject({
        candidateId: pending!.candidateId,
        state: "partially_applied",
        crossCheck: "agreement",
      });
      expect((await f.providerCalls()).map((call) => call.task)).toEqual([
        "document_freshness_candidate",
        "document_freshness_cross_check",
      ]);
      expect(await f.read("AGENTS.md")).toBe(agents(MANAGED_AFTER, PROSE_BEFORE));
    },
  );
});
