import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { inspectConfiguredDocumentNormalization } from "@lervo/repository-knowledge";

import { inspectAutonomousKnowledgeStatus } from "../src/status.js";
import {
  convergenceEvaluationContract,
  settledUnderEarlierContract,
} from "../src/evaluation-contract.js";
import {
  admitNormalizationDocuments,
  normalizationRejections,
} from "../src/normalization-rejection.js";
import { canonicalWorksetWindow } from "../src/canonical-isolation.js";
import type { ParkedConvergenceSource } from "../src/convergence-parking.js";
import { fixture } from "./fixture.js";
import {
  providerRequests,
  regenerationFeedback,
  rejectWhen,
  reviewedBatches,
  runParkingWorker,
  settleParking,
  suiteBoundSettlements,
} from "./convergence-parking-fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

/** The reason the patched fixture reviewer gives for every rejection of a.md. */
const REASON =
  "The link to runtime.md#local-runtime loses its anchor in this rewrite. (failed checks: links)";

it("regenerates a once-rejected document with the reviewer's reasons, applies the approved regeneration, and converges with an undeclared opaque asset settled by the pinned suite", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  await writeFile(resolve(f.root, "docs/specs/a.md"), "# A\n\nKeep this local contract.\n");
  // An owner's new, still untracked asset that no declaration covers.
  await writeFile(resolve(f.root, "icon.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]));
  // The first review of a.md rejects it; the regeneration carries the reason and is approved.
  await rejectWhen(
    f,
    "item.sourcePath==='docs/specs/a.md'&&!readFileSync(" +
      JSON.stringify(f.log) +
      ",'utf8').includes('independentReviewFeedback')",
  );
  expect(await settleParking(f)).toMatchObject({
    status: "processed",
    convergence: { state: "idle", lastVerifiedCurrency: expect.any(Object) },
  });
  // a.md is rejected beside the approved runtime.md, regenerated alone once with the reason, and
  // approved; nothing is reviewed or regenerated after that approval.
  expect(await reviewedBatches(f)).toEqual([
    ["docs/specs/a.md", "docs/specs/runtime.md"],
    ["docs/specs/a.md"],
  ]);
  expect(await regenerationFeedback(f)).toEqual([
    { path: "docs/specs/a.md", independentReviewFeedback: { attempt: 2, reasons: [REASON] } },
  ]);
  // The approved regeneration is applied, so no document stays pending.
  expect(
    (await inspectConfiguredDocumentNormalization({ repositoryRoot: f.root })).pendingDocuments,
  ).toEqual([]);
  // Runtime src never raises asset_verification_required; this guard only keeps the old contract.
  const stages = f.events
    .list({ limit: 1_000, types: ["repository.knowledge.stage.recorded"] })
    .map((event) => event.payload as { failureCode: string | null });
  expect(stages.some((stage) => stage.failureCode === "asset_verification_required")).toBe(false);
  // The private suite-bound evidence names the exact asset bytes and the passing suite receipts.
  expect(await suiteBoundSettlements(f)).toEqual([
    expect.objectContaining({
      sources: [expect.objectContaining({ path: "icon.png" })],
      verificationReceipts: [expect.stringMatching(/^sha256:/u)],
    }),
  ]);
}, 180_000);

it("parks an always-rejected document, carries it to the next obligation, and readmits it when edited", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  const rejected = "# A\n\nKeep this local contract.\n";
  await writeFile(resolve(f.root, "docs/specs/a.md"), rejected);
  await rejectWhen(f, "item.sourcePath==='docs/specs/a.md'");
  expect(await settleParking(f, 8)).toMatchObject({
    convergence: { state: "attention_required", reason: "knowledge_sources_parked" },
  });
  expect((await inspectAutonomousKnowledgeStatus(f.storage)).parked).toEqual({
    count: 1,
    sources: [
      { stage: "normalization", path: "docs/specs/a.md", reason: "review_rejected", attempts: 3 },
    ],
  });
  const generations = async () =>
    (await providerRequests(f)).filter((request) =>
      request.envelope?.documents.some((document) => document.path === "docs/specs/a.md"),
    ).length;
  expect(await generations()).toBe(3);
  const reviews = (await providerRequests(f)).filter(
    (request) =>
      request.task === "independent_normalization_review" &&
      (request.untrustedSourceData!.candidate as { items: { sourcePath: string }[] }).items.some(
        (item) => item.sourcePath === "docs/specs/a.md",
      ),
  );
  expect(reviews).toHaveLength(3);
  // The first review approves runtime.md and rejects a.md in one batch; only a.md is regenerated,
  // alone and each time with the reviewer's reason and its next attempt number.
  expect(await reviewedBatches(f)).toEqual([
    ["docs/specs/a.md", "docs/specs/runtime.md"],
    ["docs/specs/a.md"],
    ["docs/specs/a.md"],
  ]);
  expect(await regenerationFeedback(f)).toEqual([
    { path: "docs/specs/a.md", independentReviewFeedback: { attempt: 2, reasons: [REASON] } },
    { path: "docs/specs/a.md", independentReviewFeedback: { attempt: 3, reasons: [REASON] } },
  ]);
  // Only the rejected leading family stays pending with its exact bytes; runtime.md is applied.
  expect(
    (await inspectConfiguredDocumentNormalization({ repositoryRoot: f.root })).pendingDocuments,
  ).toEqual(["docs/specs/a.md"]);
  expect(await readFile(resolve(f.root, "docs/specs/a.md"), "utf8")).toBe(rejected);
  // The settled parking appends nothing and asks the provider nothing on the next run.
  const head = f.events.latest()!.eventHash;
  const calls = (await providerRequests(f)).length;
  await runParkingWorker(f);
  expect(f.events.latest()!.eventHash).toBe(head);
  expect(await providerRequests(f)).toHaveLength(calls);

  // An unrelated change opens a new obligation; the parked bytes are neither generated nor
  // reviewed again, so the provider sees only the new source's canonical assessment and review.
  await writeFile(resolve(f.root, "note.ts"), "export const note = 1;\n");
  expect(await settleParking(f)).toMatchObject({
    convergence: { state: "attention_required", reason: "knowledge_sources_parked" },
  });
  expect(await generations()).toBe(3);
  expect((await providerRequests(f)).slice(calls).map((request) => request.task)).toEqual([
    "canonical_baseline_assessment",
    "independent_canonical_review",
  ]);

  // Editing the parked document is the recovery: its new bytes are generated again, as a fresh
  // generation without the old bytes' feedback. The rest of that obligation repeats phase one.
  await writeFile(resolve(f.root, "docs/specs/a.md"), "# A\n\nKeep this exact local contract.\n");
  for (let cycle = 0; cycle < 16 && (await generations()) <= 3; cycle++) await runParkingWorker(f);
  expect(await generations()).toBeGreaterThan(3);
  const readmitted = (await providerRequests(f))
    .flatMap((request) => request.envelope?.documents ?? [])
    .filter((document) => document.path === "docs/specs/a.md")[3]!;
  expect(readmitted.independentReviewFeedback).toBeUndefined();
}, 300_000);

it("reevaluates a stall settled by any earlier evaluation logic exactly once", () => {
  const current = convergenceEvaluationContract();
  expect(current).toMatch(/^adr-\d{4}:[a-f0-9]{24}$/u);
  // Pre-ADR stops carried no contract; ADR-0479 and ADR-0481 settled under a reviewed constant.
  for (const dependency of [
    { kind: "normalization_rejection" },
    { kind: "canonical_target_preimage" },
    { kind: "stage_failure", code: "knowledge_stage_failure_unclassified" },
    { kind: "stage_failure", evaluationContract: "adr-0479" },
    { kind: "stage_failure", evaluationContract: "adr-0481" },
  ])
    expect(settledUnderEarlierContract(dependency)).toBe(true);
  expect(settledUnderEarlierContract({ kind: "parked_sources", evaluationContract: current })).toBe(
    false,
  );
});

const hash = (digit: string) => `sha256:${digit.repeat(64)}`;

it("admits fresh documents first, then regenerates, then parks exhausted bytes", () => {
  const sources = new Map([
    ["docs/a.md", hash("1")],
    ["docs/b.md", hash("2")],
    ["docs/c.md", hash("3")],
    ["docs/d.md", hash("4")],
  ]);
  const rejections = new Map([
    ["docs/b.md", { contentHash: hash("2"), attempts: 1, reasons: ["Lost an anchor."] }],
    ["docs/c.md", { contentHash: hash("3"), attempts: 3, reasons: ["Rewrote a managed block."] }],
    // A rejection of older bytes no longer applies.
    ["docs/d.md", { contentHash: hash("9"), attempts: 3, reasons: ["Old."] }],
  ]);
  const admission = admitNormalizationDocuments(
    ["docs/a.md", "docs/b.md", "docs/c.md", "docs/d.md"],
    sources,
    rejections,
    [],
  );
  expect(admission.fresh).toEqual(["docs/a.md", "docs/d.md"]);
  expect([...admission.regenerate]).toEqual([
    ["docs/b.md", { attempt: 2, reasons: ["Lost an anchor."] }],
  ]);
  expect(admission.parked).toEqual([
    {
      stage: "normalization",
      path: "docs/c.md",
      contentHash: hash("3"),
      reason: "review_rejected",
      attempts: 3,
      reasons: ["Rewrote a managed block."],
    },
  ]);
  // A carried parking whose bytes changed is dropped, so the edited document is admitted again.
  const changed = admitNormalizationDocuments(
    ["docs/c.md"],
    new Map([["docs/c.md", hash("5")]]),
    new Map(),
    admission.parked,
  );
  expect(changed).toMatchObject({ fresh: ["docs/c.md"], parked: [] });
});

it("skips parked canonical sources and bounds an isolation span", () => {
  const sources = ["a", "b", "c", "d", "e"].map((name, index) => ({
    path: `docs/${name}.md`,
    contentHash: hash(String(index + 1)),
    kind: "text" as const,
  }));
  const parked: ParkedConvergenceSource[] = [
    {
      stage: "canonical",
      path: "docs/a.md",
      contentHash: hash("1"),
      reason: "owner_decision",
      attempts: 1,
      reasons: [],
    },
    {
      stage: "canonical",
      path: "docs/d.md",
      contentHash: hash("4"),
      reason: "review_rejected",
      attempts: 2,
      reasons: [],
    },
  ];
  const state = { stageData: {} } as Parameters<typeof canonicalWorksetWindow>[3];
  expect(canonicalWorksetWindow(sources, 0, parked, state)).toEqual({
    offset: 1,
    maximumDocuments: 2,
  });
  expect(
    canonicalWorksetWindow(sources, 1, parked, {
      stageData: { canonicalIsolation: { offset: 1, end: 3, limit: 1 } },
    } as unknown as typeof state),
  ).toEqual({ offset: 1, maximumDocuments: 1 });
  expect(canonicalWorksetWindow(sources, 3, parked, state)).toEqual({
    offset: 4,
    maximumDocuments: 1,
  });
});

it("reads a pre-ADR-0479 rejection as one attempt and recovers its reviewer reasons", () => {
  const rejections = normalizationRejections({
    stageData: {
      normalizationRejected: { "AGENTS.md": hash("7"), "docs/x.md": hash("8") },
      normalizationReview: {
        decisions: [
          {
            operationId: "op_agents",
            sourceContentHash: hash("7"),
            decision: "reject",
            rationale: "It rewrites the managed turborepo-agent-rules region.",
            checks: { protectedRegions: false, meaning: true },
            unitReviews: [],
          },
        ],
      },
    },
  } as unknown as Parameters<typeof normalizationRejections>[0]);
  expect(Object.fromEntries(rejections)).toEqual({
    "AGENTS.md": {
      contentHash: hash("7"),
      attempts: 1,
      reasons: [
        "It rewrites the managed turborepo-agent-rules region. (failed checks: protectedRegions)",
      ],
    },
    "docs/x.md": { contentHash: hash("8"), attempts: 1, reasons: [] },
  });
  const admission = admitNormalizationDocuments(
    ["docs/x.md"],
    new Map([["docs/x.md", hash("8")]]),
    rejections,
    [],
  );
  expect(admission.regenerate.get("docs/x.md")).toEqual({
    attempt: 2,
    reasons: [
      "An independent reviewer rejected the previous rewrite of this exact source; its reasons were not retained.",
    ],
  });
});
