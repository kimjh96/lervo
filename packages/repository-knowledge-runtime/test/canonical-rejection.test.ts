import { execFileSync } from "node:child_process";
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

it.each([false, true])(
  "parks rejected canonical sources and still normalizes the rest; legacy upgrade=%s",
  { timeout: 300_000 },
  async (legacy) => {
    const f = await fixture(true, true);
    fixtures.push(f);
    const script = await readFile(f.executable, "utf8");
    const marker =
      "if(request.task==='independent_canonical_review')response={assessmentHash:data.assessmentHash,decision:'approve'";
    expect(script).toContain(marker);
    await writeFile(f.executable, script.replace(marker, marker.replace("'approve'", "'reject'")));
    const ref = () =>
      execFileSync("git", ["-C", f.root, "rev-parse", "refs/heads/knowledge-integration"], {
        encoding: "utf8",
      }).trim();
    const beforeRef = ref();
    const target = resolve(f.root, "docs/specs/runtime.md");
    const before = await readFile(target, "utf8");
    const run = () =>
      runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: "rejection",
        provider: "claude",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
        maximumStages: 1,
      });
    if (legacy) {
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
              // The pre-ADR runtime settled this dependency without an evaluation contract.
              const dependency = await f.artifacts.put(
                canonicalJson({
                  kind: "canonical_rejection",
                  snapshotHash: state.snapshotHash,
                  assessmentHash: proof.proof.assessmentHash,
                  result: proof.proof.review,
                }),
              );
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
    }
    let result: Awaited<ReturnType<typeof run>> | undefined;
    for (let i = 0; i < 64; i++) {
      result = await run();
      if (
        result.status === "processed" &&
        result.convergence.state === "attention_required" &&
        result.convergence.reason !== "knowledge_semantic_review_rejected"
      )
        break;
    }
    expect(result).toMatchObject({
      status: "processed",
      convergence: {
        state: "attention_required",
        reason: "knowledge_sources_parked",
        lastVerifiedCurrency: null,
      },
    });
    const status = await inspectAutonomousKnowledgeStatus(f.storage);
    expect(status.parked).toEqual({
      count: 1,
      sources: [
        {
          stage: "canonical",
          path: "docs/specs/runtime.md",
          reason: "review_rejected",
          attempts: 2,
        },
      ],
    });
    expect(
      (await inspectConfiguredDocumentNormalization({ repositoryRoot: f.root })).pendingDocuments,
    ).toEqual([]);
    expect(await readFile(target, "utf8")).toBe(before);
    expect(ref()).toBe(beforeRef);
    const events = [];
    for (let page = f.events.list({ limit: 1000 }); page.length;) {
      events.push(...page);
      page = f.events.list({ afterSeq: page.at(-1)!.seq, limit: 1000 });
    }
    expect(
      events.some(
        (e) =>
          e.type === "knowledge.materialization.applied" && e.payload.operation === "canonicalize",
      ),
    ).toBe(false);
    expect(
      events.some(
        (e) =>
          e.type === "repository.knowledge.convergence.recorded" &&
          e.payload.terminalState === "current",
      ),
    ).toBe(false);
    const calls = (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    // Every review judged a workset no larger than its predecessor; single sources end parked.
    const reviewed = calls
      .filter((c) => c.request.task === "independent_canonical_review")
      .map((c) => c.request.untrustedSourceData.sources.length as number);
    expect(reviewed.at(-1)).toBe(1);
    expect(calls.some((c) => c.request.envelope)).toBe(true);
    const head = f.events.latest()!.eventHash;
    const logBeforeRestart = await readFile(f.log, "utf8");
    await run();
    expect(f.events.latest()!.eventHash).toBe(head);
    expect(await readFile(f.log, "utf8")).toBe(logBeforeRestart);
  },
);

it(
  "passes semantic rejection feedback to one bounded re-assessment",
  { timeout: 180_000 },
  async () => {
    const f = await fixture(true, false);
    fixtures.push(f);
    const policyPath = resolve(f.root, ".lervo/knowledge/policy.yaml");
    const policy = JSON.parse(await readFile(policyPath, "utf8"));
    policy.normalization.exclude.push("docs/specs/runtime.md");
    await writeFile(policyPath, JSON.stringify(policy));
    const readme = resolve(f.root, "README.md");
    await writeFile(readme, `${await readFile(readme, "utf8")}\nThe runtime starts locally.\n`);
    const script = await readFile(f.executable, "utf8");
    const marker =
      "if(request.task==='independent_canonical_review')response={assessmentHash:data.assessmentHash,decision:'approve'";
    expect(script).toContain(marker);
    await writeFile(f.executable, script.replace(marker, marker.replace("'approve'", "'reject'")));
    let result: Awaited<ReturnType<typeof runAutonomousKnowledgeWorker>> | undefined;
    for (let i = 0; i < 48; i++) {
      result = await runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: "bounded-review-retry",
        provider: "claude",
        executable: f.executable,
        admissionDirectory: f.admissionDirectory,
        maximumStages: 1,
      });
      if (result.status === "processed" && result.convergence.state === "attention_required") break;
    }
    expect(result).toMatchObject({
      status: "processed",
      convergence: { state: "attention_required", reason: "knowledge_sources_parked" },
    });
    const calls = (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls.filter((c) => c.request.task === "independent_canonical_review")).toHaveLength(2);
    expect(
      calls.filter(
        (c) =>
          c.request.task === "canonical_baseline_assessment" &&
          typeof c.request.untrustedSourceData.independentReviewFeedback === "string",
      ),
    ).toHaveLength(1);
  },
);
