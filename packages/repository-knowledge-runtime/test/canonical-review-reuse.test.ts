import { readFile, rm } from "node:fs/promises";
import { afterEach, expect, it } from "vitest";
import type { KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import { runAutonomousKnowledgeWorker } from "../src/worker.js";
import { assessCanonicalBaseline } from "../src/canonical-assessment.js";
import { reviewCanonicalBaseline } from "../src/canonical-review.js";
import { findApprovedCanonicalBatch } from "../src/canonical-review-reuse.js";
import { fixture } from "./fixture.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true });
  }
});

it(
  "reuses an integrated independent review only for exact source, context and policy bindings",
  { timeout: 180_000 },
  async () => {
    const f = await fixture(true);
    fixtures.push(f);
    let integrated: ReturnType<typeof f.events.list>[number] | undefined;
    for (let cycle = 0; cycle < 12 && !integrated; cycle++) {
      await runAutonomousKnowledgeWorker({
        storage: f.storage,
        workerId: `reuse-${cycle}`,
        provider: "claude",
        executable: f.executable,
        maximumStages: 1,
        admissionDirectory: f.admissionDirectory,
      });
      integrated = f.events
        .list({ limit: 1_000 })
        .find(
          (event) =>
            event.type === "repository.knowledge.stage.recorded" &&
            event.payload.stage === "canonical_integration" &&
            event.payload.state === "current",
        );
    }
    expect(integrated).toBeDefined();
    const hash = integrated!.payload.inputArtifactHash as string;
    const prior = JSON.parse(
      Buffer.from(await f.artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`)).toString("utf8"),
    ) as KnowledgeConvergenceInput;
    const batch = prior.stageData.canonicalBatch as {
      sources: { path: string; contentHash: string }[];
      context: { path: string; contentHash: string; role: string }[];
    };
    const lookup = (
      changes: {
        sources?: typeof batch.sources;
        context?: typeof batch.context;
        state?: KnowledgeConvergenceInput;
      } = {},
    ) =>
      findApprovedCanonicalBatch({
        events: f.events,
        artifacts: f.artifacts,
        state: changes.state ?? prior,
        sources: (changes.sources ?? batch.sources) as Parameters<
          typeof findApprovedCanonicalBatch
        >[0]["sources"],
        context: (changes.context ?? batch.context) as Parameters<
          typeof findApprovedCanonicalBatch
        >[0]["context"],
      });
    expect(await lookup()).toMatchObject({ eventId: integrated!.eventId });
    expect(
      await lookup({
        sources: [
          { ...batch.sources[0]!, contentHash: "sha256:changed" },
          ...batch.sources.slice(1),
        ],
      }),
    ).toBeNull();
    expect(
      await lookup({
        context: [
          { ...batch.context[0]!, contentHash: "sha256:changed" },
          ...batch.context.slice(1),
        ],
      }),
    ).toBeNull();
    expect(
      await lookup({
        state: { ...prior, baseline: { ...prior.baseline, policyHash: "sha256:changed" } },
      }),
    ).toBeNull();

    const context = {
      storage: f.storage,
      provider: "claude" as const,
      executable: f.executable,
      admissionDirectory: f.admissionDirectory,
      signal: new AbortController().signal,
      liveWorkPending: async () => false,
      assertSource: () => {},
    };
    const callLog = await readFile(f.log, "utf8");
    const fresh = {
      ...prior,
      obligationId: "obl_reuse_test",
      stageData: { ...prior.stageData, canonicalOffset: 0 },
    };
    const assessed = await assessCanonicalBaseline(context, fresh, () => {});
    expect(assessed.input.stageData.reusedCanonicalApproval).toMatchObject({
      eventId: integrated!.eventId,
    });
    const reviewed = await reviewCanonicalBaseline(context, assessed.input, () => {});
    expect(reviewed.nextStage).toBe("canonical_integration");
    expect(await readFile(f.log, "utf8")).toBe(callLog);
  },
);
