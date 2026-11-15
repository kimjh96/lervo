import { readFile, writeFile, rm } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import {
  canonicalJson,
  processKnowledgeConvergence,
  type KnowledgeConvergenceInput,
} from "@lervo/repository-knowledge";
import { createConvergenceRuntimeHost } from "../src/host.js";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { obligationParkedSources } from "../src/convergence-parking.js";
import { fixture } from "./fixture.js";

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
    const requests = async () =>
      (await readFile(f.log, "utf8"))
        .trim()
        .split("\n")
        .map(
          (line) =>
            JSON.parse(line).request as {
              task: string;
              envelope?: { documents: { path: string }[] };
              untrustedSourceData: { independentReviewFeedback?: unknown };
            },
        );
    const reviews = async () =>
      (await requests()).filter((request) => request.task === "independent_canonical_review");
    expect(await reviews()).toHaveLength(1);
    const artifact = async <T>(hash: unknown) =>
      JSON.parse(
        Buffer.from(
          await f.artifacts.get(`lervo-cas://sha256/${(hash as string).slice(7)}`),
        ).toString("utf8"),
      ) as T;
    const settledReviews = async () =>
      Promise.all(
        f.events
          .list({ limit: 1000, types: ["repository.knowledge.stage.recorded"] })
          .filter((e) => e.payload.stage === "canonical_review" && e.payload.state === "current")
          .map((e) => artifact<KnowledgeConvergenceInput>(e.payload.resultArtifactHash)),
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
            await artifact<{
              proof: { status: string; evidence?: { retainedArtifact?: { artifactHash: string } } };
            }>(input.receipts.find((receipt) => receipt.stage === "canonical_review")!.artifactHash)
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
      (await requests())
        .filter((request) => request.task === "canonical_baseline_assessment")
        .flatMap((request) => request.untrustedSourceData.independentReviewFeedback ?? []),
    ).toEqual([legacyRationale]);
    // Parking the last canonical batch still normalizes the rest.
    expect((await requests()).some((request) => request.envelope)).toBe(false);
    await run();
    expect(
      (await requests()).some((request) =>
        request.envelope?.documents.some((document) => document.path === "docs/specs/runtime.md"),
      ),
    ).toBe(true);
  },
);
