import { rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";

import {
  documentFreshnessAttentionSources,
  inspectDocumentFreshnessStatus,
} from "../src/freshness-review.js";
import { listFreshnessCandidates } from "../src/freshness-state-store.js";
import {
  freshnessFixture,
  type FreshnessFixture,
  type FreshnessPlanEntry,
} from "./freshness-fixture.js";

const fixtures: FreshnessFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

const README = [
  "# Repository",
  "",
  "This repository holds the trading research code, its documents, and the scripts that run it.",
  "Each version keeps its own guide, and the newest guide describes the current schedule.",
  "",
  "Read the [v2 guide](v2/README.md).",
  "",
  "Learning runs every 6 hours.",
  "",
  "Questions about the layout go to the repository documents before the code.",
  "",
].join("\n");

const LINK = {
  before: "[v2 guide](v2/README.md)",
  after: "[v4 guide](v4/README.md)",
  evidencePaths: ["v4/README.md"],
};
const STATEMENT = {
  before: "Learning runs every 6 hours.",
  after: "Learning now runs on a fixed schedule.",
  evidencePaths: ["v4/README.md"],
};

/** A user-owned `README.md` whose v2 guide was replaced by v4; the owner never takes part. */
async function setup(entry: Partial<FreshnessPlanEntry> = {}) {
  const f = await freshnessFixture();
  fixtures.push(f);
  await f.write("v2/README.md", "# v2\n\nLearning runs every 6 hours.\n");
  await f.write("README.md", README);
  await f.commit("add v2 and the readme");
  await f.remove("v2");
  await f.write("v4/README.md", "# v4\n\nLearning runs daily at 00:40 UTC.\n");
  await f.commit("replace v2 with v4");
  await plan(f, entry);
  return f;
}

async function plan(f: FreshnessFixture, entry: Partial<FreshnessPlanEntry>) {
  await f.plan({ "README.md": { operation: "edit", hunks: [LINK, STATEMENT], ...entry } });
}

const minutes = (count: number) => new Date(Date.now() + count * 60_000);

describe("document freshness without the owner (ADR-0561)", () => {
  it(
    "applies a user-owned statement hunk after two agreeing independent checks",
    { timeout: 120_000 },
    async () => {
      const f = await setup();
      expect(await f.cycle(minutes(1))).toMatchObject({ appliedCount: 1 });
      const [candidate] = await listFreshnessCandidates(f.root);
      expect(candidate!.hunks.map((hunk) => [hunk.changeClass, hunk.ownership])).toEqual([
        ["factual_reference", "user_owned"],
        ["statement", "user_owned"],
      ]);
      expect(candidate).toMatchObject({
        state: "applied",
        crossCheck: "agreement",
        authorityRequired: "none",
        approval: { approvalSource: "lervo_managed" },
      });
      // Two separate no-capability sessions agreed, each with its own run.
      const rounds = [...candidate!.crossCheckRounds!, candidate!.crossCheckReview!];
      expect(rounds.map((round) => round.outcome)).toEqual(["agreement", "agreement"]);
      expect(new Set(rounds.map((round) => round.runId)).size).toBe(2);
      expect(candidate!.approval!.reviewer).toBe(
        `cross_check ${rounds.map((round) => round.runId).join(",")}`,
      );
      expect((await f.providerCalls()).map((call) => call.task)).toEqual([
        "document_freshness_candidate",
        "document_freshness_cross_check",
        "document_freshness_cross_check",
      ]);
      expect(await f.read("README.md")).toContain("Learning now runs on a fixed schedule.");
      // Both calls count inside the candidate budget.
      expect(candidate!.tokensObserved).toBe(4_500);
      expect(await f.git(["log", "-1", "--format=%B"])).toContain(
        "Lervo-Freshness-Cross-Check: agreement 2/2",
      );
      // The applied notice is information only.
      const attention = await documentFreshnessAttentionSources(f.root, new Date());
      expect(attention.applied.map((item) => item.candidateId)).toEqual([candidate!.candidateId]);
      expect(attention.held).toEqual([]);
    },
  );

  it(
    "regenerates once with the disagreement as evidence after one agreement and one disagreement, then holds",
    { timeout: 120_000 },
    async () => {
      const f = await setup({ crossCheckSequence: ["agree", "disagree", "agree", "disagree"] });
      await f.cycle(minutes(1));
      const [first] = await listFreshnessCandidates(f.root);
      expect(first).toMatchObject({
        state: "rejected",
        rejection: { reasonCode: "cross_check_disagreement", rejectorKind: "cross_check" },
      });
      expect(first!.crossCheckRounds).toHaveLength(1);
      expect((await documentFreshnessAttentionSources(f.root, new Date())).debt).toEqual([]);

      await f.cycle(minutes(2));
      const calls = await f.providerCalls();
      expect(calls.map((call) => [call.task, call.regeneration])).toEqual([
        ["document_freshness_candidate", null],
        ["document_freshness_cross_check", null],
        ["document_freshness_cross_check", null],
        ["document_freshness_candidate", "cross_check_disagreement"],
        ["document_freshness_cross_check", null],
        ["document_freshness_cross_check", null],
      ]);
      const debt = (await documentFreshnessAttentionSources(f.root, new Date())).debt;
      expect(debt).toEqual([
        expect.objectContaining({
          documentPath: "README.md",
          reason: "cross_check_disagreement_repeated",
          attempts: 1,
        }),
      ]);
      // Held with backoff: the next cycle spends nothing and the document stays as it was.
      await f.cycle(minutes(3));
      expect(await f.providerCalls()).toHaveLength(calls.length);
      expect(await f.read("README.md")).toBe(README);
    },
  );

  it(
    "recovers evidence and regenerates when the first answer cannot determine the value",
    { timeout: 120_000 },
    async () => {
      const f = await setup({
        operation: "needs_owner_input",
        hunks: [],
        explanation: "No value shown.",
      });
      await f.cycle(minutes(1));
      const [first] = await listFreshnessCandidates(f.root);
      expect(first).toMatchObject({
        operation: "needs_owner_input",
        state: "rejected",
        rejection: { reasonCode: "candidate_invalid" },
      });
      expect(await listFreshnessCandidates(f.root)).toHaveLength(1);
      await plan(f, {});
      await f.cycle(minutes(2));
      const next = (await listFreshnessCandidates(f.root)).find(
        (candidate) => candidate.candidateId !== first!.candidateId,
      );
      expect(next).toMatchObject({
        state: "applied",
        predecessorCandidateId: first!.candidateId,
      });
      expect(
        (await f.providerCalls())
          .filter((call) => call.task === "document_freshness_candidate")
          .map((call) => call.regeneration),
      ).toEqual([null, "evidence_undetermined"]);
    },
  );

  it(
    "marks the document stale as Lervo debt when regeneration still cannot determine the value",
    { timeout: 120_000 },
    async () => {
      const f = await setup({
        operation: "needs_owner_input",
        hunks: [],
        explanation: "No value shown.",
      });
      await f.cycle(minutes(1));
      await f.cycle(minutes(2));
      const status = await inspectDocumentFreshnessStatus(f.root, minutes(3));
      expect(status.debt).toEqual([
        expect.objectContaining({
          documentPath: "README.md",
          reason: "freshness_evidence_undetermined",
          attempts: 1,
        }),
      ]);
      expect(status.summary.debt).toEqual([
        expect.objectContaining({
          documentPath: "README.md",
          reason: "freshness_evidence_undetermined",
        }),
      ]);
      expect(status.summary.awaitingReviewCount).toBe(0);
      expect(await f.read("README.md")).toBe(README);
    },
  );
});
