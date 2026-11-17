import { rm, symlink } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import {
  observeDocumentFreshnessFindings,
  readDocumentFreshnessAssessments,
  sha256,
} from "@lervo/repository-knowledge";
import { buildFreshnessEvidenceBundle } from "../src/freshness-evidence-bundle.js";
import {
  captureFreshnessDependencies,
  freshnessDependenciesCurrent,
} from "../src/freshness-dependencies.js";
import {
  listFreshnessCandidates,
  readFreshnessCycleState,
  writeFreshnessCycleState,
  writeFreshnessCandidate,
} from "../src/freshness-state-store.js";
import { applyFreshnessCandidateByOwner } from "../src/freshness-apply.js";
import { recoverFreshnessCandidates } from "../src/freshness-candidate-recovery.js";
import { freshnessFixture, type FreshnessFixture } from "./freshness-fixture.js";

const fixtures: FreshnessFixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});
async function setup(version: 4 | 5 = 4) {
  const f = await freshnessFixture(version);
  fixtures.push(f);
  return f;
}
async function history(f: FreshnessFixture, directory = false) {
  await f.write("src/runtime.ts", "export const alive = true;\n");
  await f.write(
    "docs/specs/runtime.md",
    `# Runtime\n\nThe runtime stays alive. See \`src/${directory ? "" : "runtime.ts"}\`.\n`,
  );
  await f.commit("document the runtime");
  await f.write("src/runtime.ts", "export const alive = true;\nexport const count = 2;\n");
  await f.commit("add a counter without changing the documented claim");
  const observed = await observeDocumentFreshnessFindings({
    repositoryRoot: f.root,
    now: new Date(),
  });
  if (observed.status !== "observed") throw new Error("Finding observation unavailable");
  const finding = observed.findings.find((item) => item.documentPath === "docs/specs/runtime.md")!;
  expect(finding).toBeDefined();
  return finding;
}

it("expands a changed directory into hash-bound child evidence", async () => {
  const f = await setup();
  const finding = await history(f, true);
  const { bundle, evidence } = await buildFreshnessEvidenceBundle({
    repositoryRoot: f.root,
    finding,
    content: Buffer.from(await f.read(finding.documentPath)),
  });
  expect(bundle.coverage.status).toBe("ready");
  expect(bundle.directories[0]).toMatchObject({
    path: "src",
    examined: 1,
    omitted: 0,
    nextCursor: null,
  });
  expect(bundle.changedPaths[0]).toMatchObject({
    path: "src/runtime.ts",
    beforeHash: expect.any(String),
    afterHash: expect.any(String),
  });
  expect(evidence[0]!.text).toContain("count = 2");
  expect(await f.providerCalls()).toEqual([]);
});

it("keeps evidence for a large file and rejects binary and symlink data", async () => {
  const f = await setup();
  const finding = await history(f, true);
  await f.write(
    "src/runtime.ts",
    Array.from({ length: 1500 }, (_, i) => `export const count${i} = ${i};`).join("\n"),
  );
  await f.commit("large source change");
  const current = { ...finding, currentRevision: (await f.git(["rev-parse", "HEAD"])).trim() };
  const first = await buildFreshnessEvidenceBundle({
    repositoryRoot: f.root,
    finding: current,
    content: Buffer.from(await f.read(finding.documentPath)),
  });
  expect(first.bundle.evidenceTruncated).toBe(true);
  expect(first.evidence).toHaveLength(1);
  expect(first.bundle.changedPaths[0]!.excerpts).toHaveLength(40);
  await f.write("src/binary.bin", "binary\0data");
  await symlink("runtime.ts", `${f.root}/src/link.ts`);
  await f.commit("unsupported source objects");
  const next = await buildFreshnessEvidenceBundle({
    repositoryRoot: f.root,
    finding: { ...current, currentRevision: (await f.git(["rev-parse", "HEAD"])).trim() },
    content: Buffer.from(await f.read(finding.documentPath)),
  });
  expect(next.bundle.coverage.status).toBe("unavailable");
  expect(
    next.evidence.some((item) => item.path.endsWith("binary.bin") || item.path.endsWith("link.ts")),
  ).toBe(false);
});

it("settles no-change only after an independent schema-5 assessment and invalidates on a new change", async () => {
  const f = await setup(5);
  await history(f);
  await f.plan({ "docs/specs/runtime.md": { operation: "no_change_needed" } });
  await f.cycle();
  expect((await listFreshnessCandidates(f.root))[0]!.state).toBe("generated");
  expect(await readDocumentFreshnessAssessments(f.root)).toEqual([]);
  await f.cycle();
  const records = await readDocumentFreshnessAssessments(f.root);
  expect(records).toHaveLength(1);
  expect(records[0]!.assessment.assessedRevision).toMatch(/^[a-f0-9]{40}$/u);
  expect((await f.providerCalls()).map((call) => call.task)).toEqual([
    "document_freshness_candidate",
    "document_freshness_assessment_review",
  ]);
  const current = await observeDocumentFreshnessFindings({
    repositoryRoot: f.root,
    now: new Date(),
  });
  expect(
    current.status === "observed" &&
      current.findings.some((item) => item.documentPath === "docs/specs/runtime.md"),
  ).toBe(false);
  await f.write("src/runtime.ts", "export const alive = false;\n");
  const dirty = await observeDocumentFreshnessFindings({ repositoryRoot: f.root, now: new Date() });
  expect(
    dirty.status === "observed" &&
      dirty.findings.some((item) => item.documentPath === "docs/specs/runtime.md"),
  ).toBe(true);
  await f.commit("change the documented behavior");
  const stale = await observeDocumentFreshnessFindings({ repositoryRoot: f.root, now: new Date() });
  expect(
    stale.status === "observed" &&
      stale.findings.some((item) => item.documentPath === "docs/specs/runtime.md"),
  ).toBe(true);
});

it("keeps the stage closed while today's budget cannot pay for a pending no-change review", async () => {
  const f = await setup(5);
  await history(f);
  await f.plan({ "docs/specs/runtime.md": { operation: "no_change_needed" } });
  const now = new Date();
  await f.cycle(now);
  expect((await listFreshnessCandidates(f.root))[0]!.state).toBe("generated");
  const spent = await readFreshnessCycleState(f.root);
  await writeFreshnessCycleState(f.root, {
    ...spent,
    budget: { ...spent.budget, day: now.toISOString().slice(0, 10), tokensUsed: 5_000_000 },
  });
  const events = f.eventsOf("document.freshness.cycle.completed").length;
  const calls = (await f.providerCalls()).length;
  // ADR-0580: no review can run, so the cycle neither observes again nor appends an event.
  expect(await f.cycle(now)).toEqual({ status: "unchanged" });
  expect(await f.cycle(now)).toEqual({ status: "unchanged" });
  expect(f.eventsOf("document.freshness.cycle.completed")).toHaveLength(events);
  // Once the budget can pay for the review, the stage reopens and the review runs at once.
  await writeFreshnessCycleState(f.root, {
    ...(await readFreshnessCycleState(f.root)),
    budget: { ...spent.budget, day: now.toISOString().slice(0, 10), tokensUsed: 0 },
  });
  expect(await f.cycle(now)).toMatchObject({ status: "completed" });
  expect((await f.providerCalls()).slice(calls).map((call) => call.task)).toEqual([
    "document_freshness_assessment_review",
  ]);
});

it("preserves reader-first activation and rejects applying changed evidence", async () => {
  const f = await setup();
  await history(f);
  await f.plan({ "docs/specs/runtime.md": { operation: "no_change_needed" } });
  await f.cycle();
  const deferred = await f.cycle();
  expect(deferred).toMatchObject({ deferred: "freshness_assessment_reader_transition_required" });
  expect(f.eventsOf("document.freshness.assessment.recorded")).toEqual([]);
  expect(await f.providerCalls()).toHaveLength(1);
  const finding = await history(f);
  const witness = await captureFreshnessDependencies({
    root: f.root,
    finding,
    evidence: [{ path: "src/runtime.ts", hash: sha256(await f.read("src/runtime.ts")) }],
  });
  expect(witness).not.toBeNull();
  expect(await freshnessDependenciesCurrent(f.root, witness!)).toBe(true);
  await f.write("src/runtime.ts", "export const alive = false;\n");
  expect(await freshnessDependenciesCurrent(f.root, witness!)).toBe(false);
});

it("reclassifies empty legacy owner input without clearing a real approval request", async () => {
  const f = await setup();
  await history(f);
  await f.plan({ "docs/specs/runtime.md": { operation: "needs_owner_input" } });
  await f.cycle();
  const [base] = await listFreshnessCandidates(f.root);
  const { dependencyWitness: _witness, ...legacy } = base!;
  const empty = { ...legacy, evidenceCount: 0 };
  await writeFreshnessCandidate(f.root, empty);
  const context = {
    storage: f.storage,
    provider: "claude" as const,
    signal: new AbortController().signal,
    liveWorkPending: async () => false,
    now: () => new Date(),
  };
  const [recovered] = await recoverFreshnessCandidates(context, [empty]);
  expect(recovered).toMatchObject({
    state: "superseded",
    rejection: { reasonCode: "candidate_invalid" },
  });
  const genuine = { ...empty, evidenceCount: 1 };
  expect((await recoverFreshnessCandidates(context, [genuine]))[0]!.state).toBe(
    "waiting_authority",
  );
  expect(await f.providerCalls()).toHaveLength(1);
});

it("blocks owner apply when the exact reviewed source changed without a document edit", async () => {
  const f = await setup();
  await history(f);
  await f.plan({
    "docs/specs/runtime.md": {
      operation: "edit",
      hunks: [
        {
          before: "The runtime stays alive.",
          after: "The runtime stays alive with count 2.",
          evidencePaths: ["src/runtime.ts"],
        },
      ],
    },
  });
  await f.cycle();
  const [candidate] = await listFreshnessCandidates(f.root);
  expect(candidate!.afterHash).not.toBeNull();
  const before = await f.read(candidate!.documentPath);
  await f.write("src/runtime.ts", "export const alive = true;\nexport const count = 3;\n");
  await expect(
    applyFreshnessCandidateByOwner({
      storage: f.storage,
      candidate: candidate!,
      approvalHash: candidate!.afterHash!,
      reviewer: "owner",
      now: new Date(),
    }),
  ).rejects.toMatchObject({ code: "source_changed" });
  expect(await f.read(candidate!.documentPath)).toBe(before);
  expect(f.eventsOf("document.freshness.candidate.applied")).toHaveLength(0);
});
