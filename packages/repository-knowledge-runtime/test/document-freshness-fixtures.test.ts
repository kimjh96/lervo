import { createHash } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

import { revertFreshnessCandidate } from "../src/freshness-revert.js";
import {
  listFreshnessCandidates,
  readFreshnessCycleState,
  writeFreshnessCycleState,
} from "../src/freshness-state-store.js";
import { documentFreshnessAttentionSources } from "../src/freshness-review.js";
import { freshnessFixture, type FreshnessFixture } from "./freshness-fixture.js";

/** AGENTS.md invariant 5: documents a test treats as Lervo-managed or as user-owned. */
const ownership = vi.hoisted(() => ({ managed: new Set<string>(), user: new Set<string>() }));
vi.mock("@lervo/repository-knowledge", async (importOriginal) => {
  const { lervoManagedDocuments } = await import("./freshness-ownership.js");
  return lervoManagedDocuments(
    await importOriginal<typeof import("@lervo/repository-knowledge")>(),
    ownership.managed,
    ownership.user,
  );
});

const fixtures: FreshnessFixture[] = [];
afterEach(async () => {
  ownership.managed.clear();
  ownership.user.clear();
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

async function setup() {
  const f = await freshnessFixture();
  fixtures.push(f);
  return f;
}

const AGENTS_V2 = [
  "# Repository instructions",
  "",
  "Keep runtime requirements and user-owned content unchanged.",
  "",
  "Hard risk limits live in `v2/argo_v2/live/engine.py: Limits`.",
  "The live engine starts from `v2/argo_v2/live/engine.py`.",
  "",
].join("\n");

const README_V2 = [
  "# Repository",
  "",
  "See [runtime](docs/specs/runtime.md).",
  "",
  "Read the [v2 guide](v2/README.md). Learning runs every 6 hours.",
  "",
].join("\n");

/** Replays the Argo v2-to-v4 replacement: v2 exists at the verified revision, v4 replaces it. */
async function argoHistory(f: FreshnessFixture, documents: Record<string, string>) {
  await f.write("v2/argo_v2/live/engine.py", "class Limits:\n    maximum_leverage = 2\n");
  await f.write("v2/README.md", "# v2\n\nLearning runs every 6 hours.\n");
  for (const [path, content] of Object.entries(documents)) await f.write(path, content);
  await f.commit("add v2 and its documents");
  await f.remove("v2");
  await f.write("v4/argo4/live/engine.py", "class Limits:\n    maximum_leverage = 1\n");
  await f.write("v4/README.md", "# v4\n\nLearning runs daily at 00:40 UTC.\n");
  await f.commit("replace v2 with v4");
}

describe("document freshness fixtures (ADR-0463, ADR-0561)", () => {
  it(
    "F1 applies a safety correction to a Lervo-managed AGENTS.md after two agreeing checks",
    { timeout: 120_000 },
    async () => {
      const f = await setup();
      ownership.managed.add("AGENTS.md");
      await argoHistory(f, { "AGENTS.md": AGENTS_V2 });
      await f.plan({
        "AGENTS.md": {
          operation: "edit",
          hunks: [
            {
              before: "Hard risk limits live in `v2/argo_v2/live/engine.py: Limits`.",
              after: "Hard risk limits live in `v4/argo4/live/engine.py: Limits`.",
              evidencePaths: ["v4/argo4/live/engine.py"],
            },
            {
              before: "The live engine starts from `v2/argo_v2/live/engine.py`.",
              after: "The live engine starts from `v4/argo4/live/engine.py`.",
              evidencePaths: ["v4/argo4/live/engine.py"],
            },
          ],
        },
      });
      const result = await f.cycle();
      expect(result).toMatchObject({ status: "completed", candidateCount: 1, appliedCount: 1 });
      const [candidate] = await listFreshnessCandidates(f.root);
      expect(candidate).toMatchObject({
        documentPath: "AGENTS.md",
        priorityClass: "safety",
        operation: "edit",
        state: "applied",
        crossCheck: "agreement",
        authorityRequired: "none",
      });
      expect(candidate!.hunks.map((hunk) => hunk.changeClass)).toEqual([
        "safety_or_policy",
        "safety_or_policy",
      ]);
      // Two separate sessions agreed; each round is its own run.
      expect(candidate!.crossCheckRounds).toHaveLength(1);
      expect(candidate!.crossCheckRounds![0]!.runId).not.toBe(candidate!.crossCheckReview!.runId);
      expect((await f.providerCalls()).map((call) => call.task)).toEqual([
        "document_freshness_candidate",
        "document_freshness_cross_check",
        "document_freshness_cross_check",
      ]);
      // ADR-0604: the provider cited evidence and hunks by reference; no call offered a hash or id.
      expect((await f.providerCalls()).map((call) => call.offersIdentifiers)).toEqual([
        false,
        false,
        false,
      ]);
      expect(candidate!.checks.every((check) => check.status === "passed")).toBe(true);
      expect(await f.read("AGENTS.md")).toContain("`v4/argo4/live/engine.py: Limits`");
      expect(f.eventsOf("document.freshness.candidate.created")).toHaveLength(1);
      expect(f.eventsOf("document.freshness.candidate.verified")).toHaveLength(1);
      expect(f.eventsOf("document.freshness.candidate.verified")[0]?.payload).toMatchObject({
        crossCheck: "agreement",
        deliberationRunId: candidate!.crossCheckReview?.runId,
        authorityRequired: "none",
      });
      expect(f.eventsOf("document.freshness.candidate.applied")).toHaveLength(1);
      expect(await f.git(["log", "-1", "--format=%B"])).toContain(
        "Lervo-Freshness-Cross-Check: agreement 2/2",
      );
      const usage = f
        .eventsOf("resource.usage.recorded")
        .map((event) => event.payload as Record<string, unknown>)
        .filter((payload) => payload.stage === "document_freshness");
      // The generation call and the two separate Tier 0 cross-check calls.
      expect(usage).toHaveLength(3);
      expect(usage[0]).toMatchObject({ channel: "knowledge_worker", status: "observed" });
      expect(digest(AGENTS_V2)).toBe(candidate!.sourceHash);
    },
  );

  it(
    "F1 keeps the same safety correction to a user-owned AGENTS.md as a suggestion (invariant 5)",
    { timeout: 120_000 },
    async () => {
      ownership.user.add("AGENTS.md");
      const f = await setup();
      await argoHistory(f, { "AGENTS.md": AGENTS_V2 });
      await f.plan({
        "AGENTS.md": {
          operation: "edit",
          hunks: [
            {
              before: "Hard risk limits live in `v2/argo_v2/live/engine.py: Limits`.",
              after: "Hard risk limits live in `v4/argo4/live/engine.py: Limits`.",
              evidencePaths: ["v4/argo4/live/engine.py"],
            },
            {
              before: "The live engine starts from `v2/argo_v2/live/engine.py`.",
              after: "The live engine starts from `v4/argo4/live/engine.py`.",
              evidencePaths: ["v4/argo4/live/engine.py"],
            },
          ],
        },
      });
      expect(await f.cycle()).toMatchObject({ status: "completed", appliedCount: 0 });
      const [candidate] = await listFreshnessCandidates(f.root);
      expect(candidate, JSON.stringify(candidate?.rejection ?? null)).toMatchObject({
        documentPath: "AGENTS.md",
        state: "suggested",
      });
      expect(candidate!.hunks.map((hunk) => hunk.ownership)).toEqual(["user_owned", "user_owned"]);
      // No cross-check runs for bytes Lervo never applies, and the document stays as it was.
      expect((await f.providerCalls()).map((call) => call.task)).toEqual([
        "document_freshness_candidate",
      ]);
      expect(await f.read("AGENTS.md")).toBe(AGENTS_V2);
      expect(f.eventsOf("document.freshness.candidate.applied")).toHaveLength(0);
      // A later cycle neither applies it nor regenerates it while the document is unchanged.
      await f.cycle(new Date(Date.now() + 60_000));
      expect(await listFreshnessCandidates(f.root)).toHaveLength(1);
      expect(await f.read("AGENTS.md")).toBe(AGENTS_V2);
    },
  );

  const readmePlan = {
    "README.md": {
      operation: "edit" as const,
      hunks: [
        {
          before: "[v2 guide](v2/README.md)",
          after: "[v4 guide](v4/README.md)",
          evidencePaths: ["v4/README.md"],
        },
        { before: "every 6 hours", after: "daily at 00:40 UTC", evidencePaths: ["v4/README.md"] },
      ],
    },
  };

  it(
    "defers without spend or a rejected candidate when the provider fails before any model call",
    { timeout: 120_000 },
    async () => {
      const f = await setup();
      await argoHistory(f, { "README.md": README_V2 });
      await f.plan(readmePlan);
      // The version check fails, as an unusable CLI does, before any model call.
      await writeFile(f.executable, "#!/bin/sh\nexit 1\n", { mode: 0o700 });
      const result = await f.cycle();
      expect(result).not.toMatchObject({ candidateCount: 1 });
      expect(await listFreshnessCandidates(f.root)).toEqual([]);
      expect(await f.providerCalls()).toEqual([]);
      expect(f.eventsOf("document.freshness.candidate.rejected")).toHaveLength(0);
      const charged = f
        .eventsOf("resource.usage.recorded")
        .map((event) => event.payload as Record<string, unknown>)
        .filter((payload) => payload.stage === "document_freshness");
      expect(charged).toEqual([]);
    },
  );

  async function readmeCandidate(f: FreshnessFixture) {
    await argoHistory(f, { "README.md": README_V2 });
    await f.plan(readmePlan);
    expect(await f.cycle()).toMatchObject({ status: "completed", candidateCount: 1 });
    const [candidate] = await listFreshnessCandidates(f.root);
    return candidate!;
  }

  it(
    "F2 classifies README reference updates as factual and keeps the user-owned bytes a suggestion",
    { timeout: 120_000 },
    async () => {
      const f = await setup();
      const candidate = await readmeCandidate(f);
      expect(candidate).toMatchObject({
        documentPath: "README.md",
        priorityClass: "entrypoint",
        state: "suggested",
        authorityRequired: "none",
      });
      expect(
        candidate.hunks.map((hunk) => [hunk.changeClass, hunk.ownership, hunk.authorityRequired]),
      ).toEqual([
        ["factual_reference", "user_owned", "none"],
        ["factual_reference", "user_owned", "none"],
      ]);
      expect(candidate.crossCheckRounds ?? []).toEqual([]);
      expect(candidate.checks.find((check) => check.code === "references_resolve")?.status).toBe(
        "passed",
      );
      expect(await f.read("README.md")).toBe(README_V2);
    },
  );

  it(
    "F3 keeps an archive that rewrites nine inbound links as a suggestion",
    { timeout: 120_000 },
    async () => {
      const f = await setup();
      await f.write("IMPLEMENTATION-HANDOFF.md", "# Handoff\n\nThe v1 handoff.\n");
      await f.write(
        "FINAL-DESIGN.md",
        "# Final design\n\nThis v1 design follows [the handoff](IMPLEMENTATION-HANDOFF.md).\n",
      );
      for (let index = 1; index <= 9; index += 1)
        await f.write(
          `docs/notes/note-${index}.md`,
          `# Note ${index}\n\nSee [the final design](../../FINAL-DESIGN.md).\n`,
        );
      await f.commit("add the v1 design");
      await f.remove("IMPLEMENTATION-HANDOFF.md");
      await f.commit("remove v1");
      await f.plan({
        "FINAL-DESIGN.md": {
          operation: "archive",
          archiveName: "v1-final-design.md",
          currentDocumentPath: "docs/specs/runtime.md",
        },
      });
      await f.cycle();
      const candidate = (await listFreshnessCandidates(f.root)).find(
        (item) => item.documentPath === "FINAL-DESIGN.md",
      )!;
      // AGENTS.md invariant 5: the archive would rewrite links in nine user-owned notes, so Lervo
      // keeps it as a suggestion and runs no cross-check for it.
      expect(candidate).toMatchObject({
        operation: "archive",
        state: "suggested",
        authorityRequired: "none",
        approval: null,
      });
      expect(
        (await f.providerCalls())
          .filter((call) => call.document === "FINAL-DESIGN.md")
          .map((call) => call.task),
      ).toEqual(["document_freshness_candidate"]);
      expect(candidate.archive?.targetPath).toBe("docs/archive/v1-final-design.md");
      expect(candidate.archive?.inboundLinkRewrites).toHaveLength(9);
      expect(candidate.archive?.banner).toMatch(/^> Historical: archived on \d{4}-\d{2}-\d{2}\./u);
      expect(await f.read("FINAL-DESIGN.md")).toContain("# Final design");
      expect(await f.read("docs/notes/note-1.md")).toContain("(../../FINAL-DESIGN.md)");
    },
  );

  it(
    "F3 holds a Lervo-managed archive as Lervo debt when one of its two checks disagrees twice",
    { timeout: 120_000 },
    async () => {
      const f = await setup();
      ownership.managed.add("FINAL-DESIGN.md");
      await f.write("IMPLEMENTATION-HANDOFF.md", "# Handoff\n\nThe v1 handoff.\n");
      await f.write(
        "FINAL-DESIGN.md",
        "# Final design\n\nThis v1 design follows [the handoff](IMPLEMENTATION-HANDOFF.md).\n",
      );
      await f.commit("add the v1 design");
      await f.remove("IMPLEMENTATION-HANDOFF.md");
      await f.commit("remove v1");
      await f.plan({
        "FINAL-DESIGN.md": {
          operation: "archive",
          archiveName: "v1-final-design.md",
          crossCheckSequence: ["agree", "disagree", "agree", "disagree"],
        },
      });
      await f.cycle(new Date(Date.now() + 60_000));
      await f.cycle(new Date(Date.now() + 120_000));
      const candidates = (await listFreshnessCandidates(f.root)).filter(
        (item) => item.documentPath === "FINAL-DESIGN.md",
      );
      expect(candidates.map((item) => item.rejection?.reasonCode)).toEqual([
        "cross_check_disagreement",
        "cross_check_disagreement",
      ]);
      expect(await f.read("FINAL-DESIGN.md")).toContain("# Final design");
      expect((await f.git(["status", "--porcelain"])).trim()).toBe("");
      expect((await readFreshnessCycleState(f.root)).debt).toEqual([
        expect.objectContaining({
          documentPath: "FINAL-DESIGN.md",
          reason: "cross_check_disagreement_repeated",
        }),
      ]);
    },
  );

  it(
    "asks a malformed no-change review again instead of reading it as a disagreement (ADR-0604)",
    { timeout: 120_000 },
    async () => {
      // A no-change assessment is recorded in schema 5 events.
      const f = await freshnessFixture(5);
      fixtures.push(f);
      await f.write("src/flag.ts", "export const flag = 1;\n");
      await f.write("docs/specs/flag.md", "# Flag\n\nThe flag lives in `src/flag.ts`.\n");
      await f.commit("add the flag document", "2023-01-02T00:00:00Z");
      await f.write("src/flag.ts", "export const flag = 2;\n");
      await f.commit("change the flag");
      await f.plan({
        "docs/specs/flag.md": {
          operation: "no_change_needed",
          explanation: "The document names the file, not its value.",
          // Two malformed answers, then a well-formed agreement.
          assessmentSequence: ["invalid", "invalid", "agree"],
        },
      });
      // The candidate first, then its review.
      await f.cycle();
      await f.cycle(new Date(Date.now() + 60_000));
      const reviews = () =>
        f
          .providerCalls()
          .then((calls) =>
            calls.filter((call) => call.task === "document_freshness_assessment_review"),
          );
      // Asked once more at once; still malformed, it waits, charged, and is no disagreement.
      expect(await reviews()).toHaveLength(2);
      const [waiting] = await listFreshnessCandidates(f.root);
      expect(waiting).not.toMatchObject({ state: "rejected" });
      expect(waiting!.tokensObserved).toBeGreaterThan(0);
      // The next cycle asks again, and the well-formed agreement verifies it.
      await f.cycle(new Date(Date.now() + 120_000));
      expect(await reviews()).toHaveLength(3);
      const [verified] = await listFreshnessCandidates(f.root);
      expect(verified).toMatchObject({ operation: "no_change_needed", state: "verified" });
    },
  );

  it(
    "keeps an agreement with no usage unverifiable and charges an over-budget one as unavailable (ADR-0604)",
    { timeout: 120_000 },
    async () => {
      const run = async (entry: Record<string, unknown>) => {
        const f = await freshnessFixture(5);
        fixtures.push(f);
        await f.write("src/flag.ts", "export const flag = 1;\n");
        await f.write("docs/specs/flag.md", "# Flag\n\nThe flag lives in `src/flag.ts`.\n");
        await f.commit("add the flag document", "2023-01-02T00:00:00Z");
        await f.write("src/flag.ts", "export const flag = 2;\n");
        await f.commit("change the flag");
        await f.plan({
          "docs/specs/flag.md": {
            operation: "no_change_needed",
            explanation: "The document names the file, not its value.",
            ...entry,
          },
        });
        await f.cycle();
        await f.cycle(new Date(Date.now() + 60_000));
        const [candidate] = await listFreshnessCandidates(f.root);
        return candidate!;
      };
      // No usage figure: no verdict can be checked against the budget, and the call is charged
      // its request's size, never the whole budget.
      const unknown = await run({ assessmentUsage: "omit" });
      expect(unknown).not.toMatchObject({ state: "rejected" });
      expect(unknown.state).toBe("generated");
      expect(unknown.tokensObserved).toBeGreaterThan(1_500);
      expect(unknown.tokensObserved).toBeLessThan(30_000);
      // An agreement that came in over the candidate budget is unavailable, not a disagreement.
      const expensive = await run({ assessmentInputTokens: 40_000 });
      expect(expensive).toMatchObject({
        state: "rejected",
        rejection: { reasonCode: "freshness_budget_exhausted", rejectorKind: "budget" },
      });
    },
  );

  it(
    "stops paying a provider that reports no usage after three reviews, and says so (ADR-0604)",
    { timeout: 180_000 },
    async () => {
      const f = await freshnessFixture(5);
      fixtures.push(f);
      await f.write("src/flag.ts", "export const flag = 1;\n");
      await f.write("docs/specs/flag.md", "# Flag\n\nThe flag lives in `src/flag.ts`.\n");
      await f.commit("add the flag document", "2023-01-02T00:00:00Z");
      await f.write("src/flag.ts", "export const flag = 2;\n");
      await f.commit("change the flag");
      await f.plan({
        "docs/specs/flag.md": {
          operation: "no_change_needed",
          explanation: "The document names the file, not its value.",
          assessmentUsage: "omit",
        },
      });
      const reviews = async () =>
        (await f.providerCalls()).filter(
          (call) => call.task === "document_freshness_assessment_review",
        ).length;
      const start = Date.now();
      await f.cycle(new Date(start));
      for (let minute = 1; minute <= 3; minute++) await f.cycle(new Date(start + minute * 60_000));
      expect(await reviews()).toBe(3);
      // The fourth cycle pays nothing: the provider's reviews are paused.
      await f.cycle(new Date(start + 4 * 60_000));
      expect(await reviews()).toBe(3);
      const sources = await documentFreshnessAttentionSources(f.root, new Date(start + 5 * 60_000));
      expect(sources.usageUnavailable).toMatchObject({ provider: "claude", count: 3 });
    },
  );

  it(
    "keeps a usage pause across full cycles, and returns to unchanged once it ends (ADR-0604)",
    { timeout: 120_000 },
    async () => {
      const f = await freshnessFixture(5);
      fixtures.push(f);
      await f.write("src/stable.ts", "export const stable = true;\n");
      await f.write("docs/specs/stable.md", "# Stable\n\nThe flag lives in `src/stable.ts`.\n");
      await f.commit("add a stable document", "2023-01-02T00:00:00Z");
      await f.plan({});
      const start = Date.now();
      await f.cycle(new Date(start));
      const until = new Date(start + 24 * 60 * 60_000).toISOString();
      const pause = { provider: "claude", count: 3, since: new Date(start).toISOString(), until };
      await writeFreshnessCycleState(f.root, {
        ...(await readFreshnessCycleState(f.root)),
        usageUnavailable: pause,
      });
      // A full cycle over new findings keeps the pause it did not record.
      await f.write("v3/scripts/run.sh", "echo run\n");
      await f.commit("unrelated script edit");
      expect(await f.cycle(new Date(start + 60_000))).toMatchObject({ status: "completed" });
      expect((await readFreshnessCycleState(f.root)).usageUnavailable).toEqual(pause);
      expect(await f.cycle(new Date(start + 120_000))).toEqual({ status: "unchanged" });
      // The end of the pause reopens the stage once; after that nothing is due again.
      const after = Date.parse(until) + 60_000;
      expect(await f.cycle(new Date(after))).not.toEqual({ status: "unchanged" });
      expect((await readFreshnessCycleState(f.root)).usageUnavailable).toEqual({
        ...pause,
        until: null,
      });
      expect(await f.cycle(new Date(after + 60_000))).toEqual({ status: "unchanged" });
      expect(await f.providerCalls()).toEqual([]);
    },
  );

  it(
    "F4 ignores unrelated edits and settles a review-interval-only finding without a provider call",
    { timeout: 120_000 },
    async () => {
      const f = await setup();
      await f.write("src/stable.ts", "export const stable = true;\n");
      await f.write("docs/specs/stable.md", "# Stable\n\nThe flag lives in `src/stable.ts`.\n");
      await f.commit("add a stable document", "2023-01-02T00:00:00Z");
      await f.write("v3/scripts/run.sh", "echo run\n");
      await f.commit("unrelated script edit");
      await f.plan({});
      await f.cycle();
      const candidates = await listFreshnessCandidates(f.root);
      expect(
        candidates.map((candidate) => [
          candidate.documentPath,
          candidate.operation,
          candidate.state,
        ]),
      ).toEqual([["docs/specs/stable.md", "no_change_needed", "verified"]]);
      expect(await f.providerCalls()).toEqual([]);
    },
  );

  it(
    "F5 supersedes a suggestion when the owner edits the document and regenerates after commit",
    { timeout: 120_000 },
    async () => {
      const f = await setup();
      await argoHistory(f, { "README.md": README_V2 });
      await f.plan(readmePlan);
      await f.cycle();
      const [first] = await listFreshnessCandidates(f.root);
      expect(first).toMatchObject({ state: "suggested" });
      await f.write("README.md", `${README_V2}\nAn owner note.\n`);
      await f.cycle(new Date(Date.now() + 1_000));
      const superseded = (await listFreshnessCandidates(f.root)).find(
        (item) => item.candidateId === first!.candidateId,
      );
      expect(superseded).toMatchObject({
        state: "superseded",
        rejection: { reasonCode: "source_changed" },
      });
      expect(
        f
          .eventsOf("document.freshness.candidate.rejected")
          .map((event) => event.payload.reasonCode),
      ).toContain("source_changed");
      await f.commit("owner note");
      await f.plan(readmePlan);
      await f.cycle(new Date(Date.now() + 2_000));
      const next = (await listFreshnessCandidates(f.root)).filter(
        (item) => item.documentPath === "README.md" && item.state === "suggested",
      );
      expect(next).toHaveLength(1);
      expect(next[0]!.candidateId).not.toBe(first!.candidateId);
      expect(await f.read("README.md")).toContain("An owner note.");
    },
  );

  it(
    "F6 applies a Lervo-managed README candidate itself, reverts it on request, and holds the finding",
    { timeout: 120_000 },
    async () => {
      const f = await setup();
      ownership.managed.add("README.md");
      const applied = await readmeCandidate(f);
      expect(applied).toMatchObject({ state: "applied", appliedHash: applied.afterHash });
      expect(await f.read("README.md")).toContain(
        "[v4 guide](v4/README.md). Learning runs daily at 00:40 UTC.",
      );
      expect(applied.commitHash).toMatch(/^[a-f0-9]{40}$/u);
      const log = await f.git(["log", "-1", "--format=%an%n%B"]);
      expect(log.startsWith("Lervo Knowledge\n")).toBe(true);
      expect(log).toContain(`Lervo-Freshness-Candidate: ${applied.candidateId}`);
      const reverted = await revertFreshnessCandidate({
        storage: f.storage,
        candidate: applied,
        revertedBy: "owner",
        holdDays: 7,
        now: new Date(),
      });
      expect(reverted.state).toBe("reverted");
      expect(await f.read("README.md")).toBe(README_V2);
      expect(f.eventsOf("document.freshness.candidate.reverted")).toHaveLength(1);
      const later = await f.cycle(new Date(Date.now() + 86_400_000));
      expect(later).toMatchObject({ status: "completed", candidateCount: 0 });
      expect(
        f.eventsOf("document.freshness.cycle.completed").at(-1)?.payload.skippedForHold,
      ).toBeGreaterThanOrEqual(1);
    },
  );

  it(
    "F7 applies the managed-block hunk and keeps the user prose hunk as a suggestion",
    { timeout: 120_000 },
    async () => {
      const f = await setup();
      const agents = (routes: string, guide: string) =>
        [
          "# Repository instructions",
          "",
          "Keep runtime requirements and user-owned content unchanged.",
          "",
          "<!-- lervo:begin block=routes schema=1 -->",
          `Generated routes are listed in \`${routes}\`.`,
          "<!-- lervo:end block=routes -->",
          "",
          `The build guide lives in \`${guide}\`.`,
          "",
        ].join("\n");
      await f.write("docs/old/routes.md", "# Routes\n\nThe generated route table.\n");
      await f.write("ops/old-build.md", "# Build\n\nThe build guide.\n");
      await f.write("AGENTS.md", agents("docs/old/routes.md", "ops/old-build.md"));
      await f.commit("add routes and build guide");
      await f.git(["mv", "docs/old/routes.md", "docs/routes.md"]);
      await f.git(["mv", "ops/old-build.md", "ops/build.md"]);
      await f.commit("move routes and build guide");
      await f.plan({
        "AGENTS.md": {
          operation: "edit",
          hunks: [
            {
              before: "Generated routes are listed in `docs/old/routes.md`.",
              after: "Generated routes are listed in `docs/routes.md`.",
              evidencePaths: ["docs/routes.md"],
            },
            {
              before: "The build guide lives in `ops/old-build.md`.",
              after: "The build guide lives in `ops/build.md`.",
              evidencePaths: ["ops/build.md"],
            },
          ],
        },
      });
      await f.cycle();
      const [candidate] = await listFreshnessCandidates(f.root);
      expect(candidate).toMatchObject({ state: "partially_applied", authorityRequired: "none" });
      const [managed, prose] = candidate!.hunks;
      expect(managed).toMatchObject({
        ownership: "lervo_managed",
        managedBlockId: "routes",
        changeClass: "factual_reference",
        authorityRequired: "none",
        crossCheckRequired: false,
      });
      expect(prose).toMatchObject({
        ownership: "user_owned",
        authorityRequired: "none",
        crossCheckRequired: true,
      });
      // AGENTS.md invariant 5: Lervo writes only its managed block; the prose stays a suggestion.
      expect(candidate!.appliedHunkIds).toEqual([managed!.hunkId]);
      expect(candidate!.pendingHunkIds).toEqual([prose!.hunkId]);
      expect(await f.read("AGENTS.md")).toBe(agents("docs/routes.md", "ops/old-build.md"));
      expect(f.eventsOf("document.freshness.candidate.applied").at(-1)?.payload).toMatchObject({
        approvalSource: "lervo_managed",
        appliedHunkCount: 1,
        pendingHunkCount: 1,
      });
      // The partial apply is not regenerated while only the suggestion remains.
      await f.cycle(new Date(Date.now() + 60_000));
      expect(await listFreshnessCandidates(f.root)).toHaveLength(1);
    },
  );
});
