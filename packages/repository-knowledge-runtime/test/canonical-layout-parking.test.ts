import { access, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse, stringify } from "yaml";
import { afterEach, expect, it, vi } from "vitest";
import { canonicalJson, sha256, type KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import type { OutboxStore } from "@lervo/storage-contract";
import { fixture } from "./fixture.js";
import { discoverConvergenceBaseline } from "../src/baseline.js";
import { canonicalDocumentLayout } from "../src/canonical-layout.js";
import { integrateCanonicalBaseline } from "../src/canonical-integration-stage.js";
import { carriedParkedSources, type ParkedConvergenceSource } from "../src/convergence-parking.js";
import type { CanonicalBatch } from "../src/canonical-review.js";
import * as recovery from "../src/canonical-integration-recovery.js";
import * as capacityRecovery from "../src/canonical-capacity-recovery.js";

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});
async function repository(maxDirectDocuments = 24) {
  const f = await fixture(true);
  fixtures.push(f);
  const layoutPath = resolve(f.root, ".lervo/knowledge/document-layout.yaml");
  const layout = parse(await readFile(layoutPath, "utf8"));
  layout.documentPolicy.capacity.maxDirectDocuments = maxDirectDocuments;
  await writeFile(layoutPath, stringify(layout));
  for (let i = 0; i < 31; i++)
    await writeFile(resolve(f.root, `docs/specs/existing-${i}.md`), `# Existing ${i}\n`);
  await writeFile(resolve(f.root, "candidate.ts"), "export const fact = 1;\n");
  await writeFile(resolve(f.root, "covered.ts"), "export const documented = true;\n");
  const baseline = await discoverConvergenceBaseline(f.root, f.events, f.artifacts);
  baseline.assessmentPaths = ["candidate.ts", "covered.ts"];
  const state: KnowledgeConvergenceInput = {
    schemaVersion: 1,
    obligationId: "kconv_layout",
    baseline,
    snapshotHash: baseline.sourceSnapshotHash,
    stageData: {},
    receipts: [],
  };
  return { f, state, layoutPath, layout };
}

it.each([
  [false, 24, false],
  [false, 32, false],
  [true, 32, false],
  [false, 32, true],
] as const)(
  "parks the approved capacity-blocked batch; remaining workset=%s, bound=%s, retained=%s",
  async (more, limit, retained) => {
    const { f, state } = await repository(limit);
    const sources = state.baseline.assessmentPaths!.map((path) =>
      state.baseline.sources.find((source) => source.path === path)!,
    );
    if (more) state.baseline.assessmentPaths!.push("README.md");
    const batch: CanonicalBatch = {
      offset: 0,
      count: 2,
      sources,
      context: [],
      batchId: "layout",
      generatorAgentId: "generator",
      assessment: {
        decisions: sources.map((source, index) => ({
          path: source.path,
          contentHash: source.contentHash,
          disposition: index === 0 ? "candidate" : "covered",
          rationale: "Exact fixture decision.",
          canonicalReferences: [],
        })),
        drafts: ["docs/specs/new-a.md", "docs/specs/new-b.md"].map((path) => ({
          path,
          beforeHash: null,
          content: "# Reviewed draft\n",
        })),
      },
    };
    state.stageData = {
      canonicalBatch: batch,
      canonicalApproval: {
        assessmentHash: sha256(canonicalJson(batch.assessment)),
        delegationHash: state.baseline.delegationHash,
        policyHash: state.baseline.policyHash,
      },
    };
    if (retained) {
      vi.spyOn(recovery, "inspectRetainedCanonicalIntegration").mockResolvedValueOnce({
        plan: { targetRef: "refs/heads/knowledge-integration" },
        completion: { targetAfterCommit: "1".repeat(40) },
      } as unknown as NonNullable<
        Awaited<ReturnType<typeof recovery.inspectRetainedCanonicalIntegration>>
      >);
      vi.spyOn(capacityRecovery, "retireCapacityBlockedRefDrafts").mockResolvedValueOnce({
        ref: "refs/heads/knowledge-integration",
        before: "1".repeat(40),
        after: "2".repeat(40),
        paths: batch.assessment.drafts.map((draft) => draft.path),
      });
    }
    const result = await integrateCanonicalBaseline(
      {
        storage: f.storage,
        provider: "claude",
        signal: new AbortController().signal,
        liveWorkPending: async () => false,
        assertSource: () => {},
      },
      state,
      () => {},
    );
    expect(result).toMatchObject({
      state: "current",
      nextStage: more ? "assessment" : "normalization_generation",
      failureCode: null,
      input: {
        stageData: {
          canonicalOffset: 2,
          canonicalBatch: null,
          canonicalApproval: null,
          canonicalTargetParked: sha256(canonicalJson(batch.assessment)),
        },
      },
    });
    expect(result.input.stageData.parkedSources).toEqual([
      expect.objectContaining({
        path: "candidate.ts",
        reason: "layout_capacity_exceeded",
        layoutCapacityHash: (await canonicalDocumentLayout(f.root)).capacityHash,
      }),
    ]);
    expect(result.input.stageData.canonicalCoverage).toEqual([
      expect.objectContaining({ path: "covered.ts", disposition: "covered" }),
    ]);
    await expect(access(resolve(f.root, "docs/specs/new-a.md"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const receipt = result.input.receipts.find((item) => item.stage === "canonical_integration")!;
    const proof = JSON.parse(
      Buffer.from(
        await f.artifacts.get(`lervo-cas://sha256/${receipt.artifactHash.slice(7)}`),
      ).toString("utf8"),
    );
    expect(proof.approvedEffects).toEqual([]);
    if (retained) {
      expect(capacityRecovery.retireCapacityBlockedRefDrafts).toHaveBeenCalledOnce();
      expect(proof.proof.retiredRefEffect).toMatchObject({
        before: "1".repeat(40),
        after: "2".repeat(40),
      });
    }
  },
);

it("supplies routing, capacity overrides, and full-directory counts to target selection", async () => {
  const { f, layout } = await repository();
  const { guidance } = await canonicalDocumentLayout(f.root);
  expect(guidance.routes).toEqual(layout.routes);
  expect(guidance.decisionRoot).toBe(layout.decisionRoot);
  expect(guidance.capacity.maxDirectDocuments).toBe(24);
  expect(guidance.observed.directDocuments["docs/specs"]).toBe(32);
});

it("carries capacity parking until source bytes, counts, or policy change", async () => {
  const { f, state, layoutPath, layout } = await repository();
  const source = state.baseline.sources.find((item) => item.path === "candidate.ts")!;
  const parked: ParkedConvergenceSource = {
    stage: "canonical",
    path: source.path,
    contentHash: source.contentHash,
    reason: "layout_capacity_exceeded",
    attempts: 1,
    reasons: ["document_directory_file_capacity_exceeded"],
    layoutCapacityHash: (await canonicalDocumentLayout(f.root)).capacityHash,
  };
  const dependency = await f.artifacts.put(
    canonicalJson({ code: "knowledge_sources_parked", sources: [parked] }),
  );
  const store = {
    ...f.storage,
    events: {
      list: ({ afterSeq }: { afterSeq: number }) =>
        afterSeq > 0
          ? []
          : [
              {
                seq: 1,
                payload: {
                  failureCode: "knowledge_sources_parked",
                  dependencyHash: dependency.contentHash,
                },
              },
            ],
    } as unknown as OutboxStore,
  };
  expect(await carriedParkedSources(store, state)).toEqual([parked]);
  await writeFile(resolve(f.root, "docs/specs/existing-0.md"), "# Edited bytes, same capacity\n");
  expect(await carriedParkedSources(store, state)).toEqual([parked]);
  const changed = structuredClone(state);
  changed.baseline.sources.find((item) => item.path === source.path)!.contentHash =
    sha256("changed source");
  expect(await carriedParkedSources(store, changed)).toEqual([]);
  layout.documentPolicy.capacity.maxDirectDocuments = 40;
  await writeFile(layoutPath, stringify(layout));
  expect(await carriedParkedSources(store, state)).toEqual([]);
  layout.documentPolicy.capacity.maxDirectDocuments = 24;
  await writeFile(layoutPath, stringify(layout));
  await rm(resolve(f.root, "docs/specs/existing-1.md"));
  expect(await carriedParkedSources(store, state)).toEqual([]);
});
