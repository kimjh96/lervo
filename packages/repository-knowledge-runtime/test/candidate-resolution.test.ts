import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as knowledge from "@lervo/repository-knowledge";
import {
  assessCanonicalization,
  canonicalizationCandidatePath,
  listCanonicalizationCandidates,
  sha256,
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStageResult,
} from "@lervo/repository-knowledge";
import { discoverConvergenceBaseline } from "../src/baseline.js";
import { resolveConvergenceCandidates } from "../src/candidate-resolution.js";
import { reviewKnowledgeJson } from "../src/provider-call.js";
import type { ConvergenceDelegation } from "../src/delegation.js";
import type { ConvergenceRuntimeContext } from "../src/stage-context.js";
import { fixture } from "./fixture.js";

let delegation: ConvergenceDelegation | null = null;

vi.mock("../src/provider-call.js", () => ({ reviewKnowledgeJson: vi.fn() }));
// Each role is staffed by its own agent, as the delegation's role bindings require.
vi.mock("../src/workforce.js", () => ({
  withConvergenceAssignment: async (input: {
    role: string;
    run(authority: unknown): Promise<unknown>;
  }) =>
    input.run({
      assignment: { assignmentId: `asn_candidate_${input.role}` },
      agent: { agentId: `agt_candidate_${input.role}` },
      delegation,
      assertCurrent: async () => {},
    }),
}));

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(reviewKnowledgeJson).mockReset();
  delegation = null;
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

const RATIONALE =
  "The independently reviewed current source facts preserve the existing durable runtime contract. This historical candidate is obsolete under the exact source-bound baseline coverage.";

/** Old exact canonicalization candidates, one per source, then the obligation that observes them. */
async function candidates(sources: Record<string, string>) {
  const f = await fixture(true);
  fixtures.push(f);
  delegation = f.delegation;
  for (const [index, [path, content]] of Object.entries(sources).entries()) {
    await writeFile(resolve(f.root, path), content);
    await assessCanonicalization({
      repositoryRoot: f.root,
      beforeRevision: sha256(`before-${index}`),
      afterRevision: sha256(`after-${index}`),
      beforeFiles: {},
      afterFiles: { [path]: sha256(content) },
      disposition: "canonical_sources_current",
      now: new Date(),
    });
  }
  expect(await listCanonicalizationCandidates(f.root)).toHaveLength(Object.keys(sources).length);
  const baseline = await discoverConvergenceBaseline(f.root, f.events, f.artifacts);
  const state: KnowledgeConvergenceInput = {
    schemaVersion: 1,
    obligationId: "kconv_candidate_resolution",
    baseline,
    snapshotHash: baseline.sourceSnapshotHash,
    stageData: {},
    receipts: [],
  };
  const context: ConvergenceRuntimeContext = {
    storage: f.storage,
    provider: "claude",
    signal: new AbortController().signal,
    liveWorkPending: async () => false,
    assertSourceExact: () => {},
    assertSourceCurrent: () => {},
  };
  vi.mocked(reviewKnowledgeJson).mockImplementation(async (input) => {
    const { candidates } = input.untrustedSourceData as {
      candidates: { candidateId: string; contentHash: string }[];
    };
    return {
      value: {
        decisions: candidates.map((candidate) => ({
          candidateId: candidate.candidateId,
          contentHash: candidate.contentHash,
          decision: "reject",
          rationale: RATIONALE,
          targetPath: null,
          targetContentHash: null,
          targetQuote: null,
        })),
      },
      usage: { fixture: true },
      admissionObservationHash: sha256("admission"),
      observationArtifactHash: sha256("observation"),
    };
  });
  return {
    f,
    state,
    resolveFrom: (input: KnowledgeConvergenceInput) =>
      resolveConvergenceCandidates(context, input, () => {}),
  };
}

function reviewedCandidates() {
  return vi
    .mocked(reviewKnowledgeJson)
    .mock.calls.map(
      ([input]) =>
        (input.untrustedSourceData as { candidates: { candidateId: string }[] }).candidates,
    );
}

it("independently closes an old exact candidate and never repeats its transition after an interrupted settlement", async () => {
  const { f, state, resolveFrom } = await candidates({
    "src.ts": "export const localRuntime = true;\n",
  });
  const reviewed = (await resolveFrom(state))!;
  expect(reviewed).toMatchObject({ state: "current", nextStage: "lifecycle_verification" });
  expect(reviewed.input.stageData.candidateReview).toMatchObject({
    reviewerAgentId: "agt_candidate_reviewer",
    decisions: [{ decision: "reject" }],
  });
  expect((await listCanonicalizationCandidates(f.root))[0]!.state).not.toBe("rejected");

  const transition = vi.spyOn(knowledge, "transitionCanonicalizationCandidate");
  const applied = (await resolveFrom(reviewed.input))!;
  expect(applied).toMatchObject({
    state: "current",
    input: { stageData: { candidateReview: null } },
  });
  expect(transition).toHaveBeenCalledOnce();
  const [closed] = await listCanonicalizationCandidates(f.root);
  expect(closed).toMatchObject({ state: "rejected" });
  const path = resolve(f.root, canonicalizationCandidatePath(closed!.candidateId));
  const bytes = await readFile(path, "utf8");

  // A crash after the transition and before settlement redelivers the reviewed input.
  const redelivered: KnowledgeConvergenceStageResult = (await resolveFrom(reviewed.input))!;
  expect(redelivered).toMatchObject({ state: "current" });
  expect(transition).toHaveBeenCalledOnce();
  expect(await readFile(path, "utf8")).toBe(bytes);

  // The closed candidate leaves no debt, so a later lifecycle pass asks no provider.
  expect(await resolveFrom(applied.input)).toBeNull();
  expect(reviewKnowledgeJson).toHaveBeenCalledOnce();
});

it("reviews old candidates with separate source-specific contexts", async () => {
  const { state, resolveFrom } = await candidates({
    "first.ts": "export const candidate0 = true;\n",
    "second.ts": "export const candidate1 = true;\n",
  });
  // Review and close each candidate in turn until no candidate debt remains.
  let input: KnowledgeConvergenceInput | undefined = state;
  for (let step = 0; step < 6 && input !== undefined; step++)
    input = (await resolveFrom(input))?.input;
  expect(input).toBeUndefined();
  const reviews = reviewedCandidates();
  expect(reviews).toEqual([
    [expect.objectContaining({ candidateId: expect.any(String) })],
    [expect.objectContaining({ candidateId: expect.any(String) })],
  ]);
  expect(new Set(reviews.map(([candidate]) => candidate!.candidateId)).size).toBe(2);
});
