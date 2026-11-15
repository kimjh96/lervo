import { readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  canonicalJson,
  inspectConfiguredDocumentNormalization,
  processKnowledgeConvergence,
  type KnowledgeConvergenceInput,
} from "@lervo/repository-knowledge";
import { createConvergenceRuntimeHost } from "../src/host.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { inspectAutonomousKnowledgeStatus } from "../src/status.js";
import { obligationParkedSources } from "../src/convergence-parking.js";
import { settledCanonicalDispositions } from "../src/canonical-disposition-ledger.js";
import { fixture } from "./fixture.js";
import {
  allEvents,
  canonicalSettlementEffects,
  casJson,
  integrationRef,
  providerRequests,
  rejectWhen,
  runParkingWorker,
  settleParking,
} from "./convergence-parking-fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

it(
  "reuses a pre-ADR-0479 canonical rejection as the first bounded attempt without another review",
  { timeout: 180_000 },
  async () => {
    const f = await fixture(true, true);
    fixtures.push(f);
    const script = await readFile(f.executable, "utf8");
    const marker =
      "if(request.task==='independent_canonical_review')response={assessmentHash:data.assessmentHash,decision:'approve'";
    expect(script).toContain(marker);
    await writeFile(f.executable, script.replace(marker, marker.replace("'approve'", "'reject'")));
    // A pre-ADR-0479 owner stopped the whole obligation at its first rejected review.
    const context = {
      storage: f.storage,
      provider: "claude" as const,
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
      signal: new AbortController().signal,
      liveWorkPending: async () => false,
      assertSourceExact: () => {},
      assertSourceCurrent: () => {},
    };
    const host = createConvergenceRuntimeHost(context);
    let legacyRationale: string | undefined;
    let legacyDependency: string | undefined;
    for (let i = 0; i < 8; i++) {
      const status = await processKnowledgeConvergence({
        events: f.events,
        artifacts: f.artifacts,
        workerId: "legacy",
        writableEventSchemaVersion: 4,
        maximumStages: 1,
        host: {
          ...host,
          runStage: async (stage, state, assertLease) => {
            const result = await host.runStage(stage, state, assertLease);
            const receipt = result.input.receipts.find((item) => item.stage === stage);
            if (stage !== "canonical_review" || receipt === undefined) return result;
            const proof = JSON.parse(
              Buffer.from(
                await f.artifacts.get(`lervo-cas://sha256/${receipt.artifactHash.slice(7)}`),
              ).toString("utf8"),
            );
            if (proof.proof.status !== "review_rejected_for_bounded_retry") return result;
            legacyRationale = proof.proof.review.rationale;
            // The pre-ADR runtime settled this dependency without an evaluation contract.
            const dependency = await f.artifacts.put(
              canonicalJson({
                kind: "canonical_rejection",
                snapshotHash: state.snapshotHash,
                assessmentHash: proof.proof.assessmentHash,
                result: proof.proof.review,
              }),
            );
            legacyDependency = dependency.contentHash;
            return {
              state: "attention_required" as const,
              input: state,
              assignmentId: null,
              leaseGeneration: null,
              failureCode: "knowledge_semantic_review_rejected",
              dependencyHash: dependency.contentHash,
              nextStage: null,
            };
          },
        },
      });
      if (status.reason === "knowledge_semantic_review_rejected") break;
    }
    expect(
      f.events
        .list({ limit: 1000 })
        .some(
          (e) =>
            e.type === "repository.knowledge.stage.recorded" &&
            e.payload.stage === "canonical_review" &&
            e.payload.state === "attention_required",
        ),
    ).toBe(true);
    const reviews = async () =>
      (await providerRequests(f)).filter(
        (request) => request.task === "independent_canonical_review",
      );
    expect(await reviews()).toHaveLength(1);
    const settledReviews = async () =>
      Promise.all(
        f.events
          .list({ limit: 1000, types: ["repository.knowledge.stage.recorded"] })
          .filter((e) => e.payload.stage === "canonical_review" && e.payload.state === "current")
          .map((e) =>
            casJson<KnowledgeConvergenceInput>(f.artifacts, e.payload.resultArtifactHash),
          ),
      );
    // The upgraded worker requeues the stall once and judges the retained rejection again. The case
    // stops after the parked source hands over to normalization; convergence-parking.test.ts covers
    // the rest of the obligation.
    const parked = async () => {
      const latest = (await settledReviews()).at(-1);
      return latest === undefined
        ? []
        : obligationParkedSources(latest).map(({ stage, path, reason, attempts }) => ({
            stage,
            path,
            reason,
            attempts,
          }));
    };
    const run = () =>
      runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: "rejection",
        provider: "claude",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
        maximumStages: 1,
      });
    for (let i = 0; i < 8 && (await parked()).length === 0; i++) await run();
    expect(await parked()).toEqual([
      { stage: "canonical", path: "docs/specs/runtime.md", reason: "review_rejected", attempts: 2 },
    ]);
    // The requeued review settles from the retained artifact, so it neither calls the provider nor
    // replays a cached review; that retained rejection is the first of the two bounded attempts.
    const proofs = await Promise.all(
      (await settledReviews()).map(
        async (input) =>
          (
            await casJson<{
              proof: { status: string; evidence?: { retainedArtifact?: { artifactHash: string } } };
            }>(
              f.artifacts,
              input.receipts.find((receipt) => receipt.stage === "canonical_review")!.artifactHash,
            )
          ).proof,
      ),
    );
    expect(
      proofs.map((proof) => [proof.status, proof.evidence?.retainedArtifact?.artifactHash ?? null]),
    ).toEqual([
      ["review_rejected_for_bounded_retry", legacyDependency],
      ["source_parked", null],
    ]);
    expect(await reviews()).toHaveLength(2);
    // One re-assessment carries the retained reviewer's rationale.
    expect(
      (await providerRequests(f))
        .filter((request) => request.task === "canonical_baseline_assessment")
        .flatMap((request) => request.untrustedSourceData!.independentReviewFeedback ?? []),
    ).toEqual([legacyRationale]);
    // Parking the last canonical batch still normalizes the rest.
    expect((await providerRequests(f)).some((request) => request.envelope)).toBe(false);
    await run();
    expect(
      (await providerRequests(f)).some((request) =>
        request.envelope?.documents.some((document) => document.path === "docs/specs/runtime.md"),
      ),
    ).toBe(true);
  },
);

it("isolates one rejected canonical source by halving its workset and integrates the rest", async () => {
  const f = await fixture(true);
  fixtures.push(f);
  for (const name of ["a", "b", "c"])
    await writeFile(
      resolve(f.root, `docs/specs/${name}.md`),
      `# ${name.toUpperCase()}\n\nThe ${name} contract stays local.\n`,
    );
  await rejectWhen(f, "false", "data.sources.some(source=>source.path==='docs/specs/b.md')");
  const refBefore = integrationRef(f);
  const runtime = resolve(f.root, "docs/specs/runtime.md");
  const runtimeBefore = await readFile(runtime, "utf8");
  expect(await settleParking(f, 48)).toMatchObject({
    status: "processed",
    convergence: {
      state: "attention_required",
      reason: "knowledge_sources_parked",
      lastVerifiedCurrency: null,
    },
  });
  expect((await inspectAutonomousKnowledgeStatus(f.storage)).parked).toEqual({
    count: 1,
    sources: [
      { stage: "canonical", path: "docs/specs/b.md", reason: "review_rejected", attempts: 2 },
    ],
  });
  const reviewed = (await providerRequests(f))
    .filter((request) => request.task === "independent_canonical_review")
    .map((request) =>
      (request.untrustedSourceData!.sources as { path: string }[]).map((source) => source.path),
    );
  // Reviews containing b.md shrink until b.md alone is judged, then it is parked.
  const withB = reviewed.filter((paths) => paths.includes("docs/specs/b.md"));
  expect(withB.at(-1)).toEqual(["docs/specs/b.md"]);
  expect(withB.map((paths) => paths.length)).toEqual(
    withB.map((paths) => paths.length).toSorted((left, right) => right - left),
  );
  expect(reviewed.flat()).toEqual(expect.arrayContaining(["docs/specs/a.md", "docs/specs/c.md"]));
  // Each rejected workset is reviewed twice around one re-assessment that carries the reviewer's
  // rationale; no other assessment receives feedback.
  const worksets = [...new Set(withB.map((paths) => paths.join(",")))];
  expect(withB.map((paths) => paths.join(","))).toEqual(
    worksets.flatMap((paths) => [paths, paths]),
  );
  expect(
    (await providerRequests(f))
      .filter((request) => request.task === "canonical_baseline_assessment")
      .flatMap((request) => request.untrustedSourceData!.independentReviewFeedback ?? []),
  ).toEqual(
    worksets.map(
      () =>
        "The workset claims coverage for docs/specs/b.md that no exact canonical quotation supports.",
    ),
  );
  expect(
    (await inspectConfiguredDocumentNormalization({ repositoryRoot: f.root })).pendingDocuments,
  ).toEqual([]);
  expect((await providerRequests(f)).some((request) => request.envelope)).toBe(true);
  // The approved siblings are integrated; the parked source settles nothing canonical.
  const events = allEvents(f.events);
  const integration = events.find(
    (event) =>
      event.type === "repository.knowledge.stage.recorded" &&
      event.payload.stage === "canonical_integration" &&
      event.payload.state === "current",
  );
  const integratedInput = await casJson<{ baseline: { projectId: string; policyHash: string } }>(
    f.artifacts,
    integration!.payload.inputArtifactHash,
  );
  const reviewedSources = new Map(
    (await providerRequests(f))
      .filter((request) => request.task === "independent_canonical_review")
      .flatMap(
        (request) =>
          request.untrustedSourceData!.sources as { path: string; contentHash: string }[],
      )
      .map((source) => [source.path, source.contentHash]),
  );
  const settled = await settledCanonicalDispositions({
    repositoryRoot: f.root,
    events: f.events,
    artifacts: f.artifacts,
    projectId: integratedInput.baseline.projectId,
    policyHash: integratedInput.baseline.policyHash,
    sources: ["a", "b", "c"].map((name) => ({
      path: `docs/specs/${name}.md`,
      contentHash: reviewedSources.get(`docs/specs/${name}.md`)!,
    })),
  });
  expect(settled.map((item) => item.path)).toEqual(["docs/specs/a.md", "docs/specs/c.md"]);
  expect(await readFile(runtime, "utf8")).toBe(runtimeBefore);
  expect(integrationRef(f)).toBe(refBefore);
  expect(canonicalSettlementEffects(f.events)).toEqual({ canonicalize: false, current: false });
  // A restart after parking appends nothing and asks the provider nothing.
  const head = f.events.latest()!.eventHash;
  const log = await readFile(f.log, "utf8");
  await runParkingWorker(f);
  expect(f.events.latest()!.eventHash).toBe(head);
  expect(await readFile(f.log, "utf8")).toBe(log);
}, 300_000);
