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
import { fixture } from "./fixture.js";
import { obligationInput, seamContext, workforceSeam } from "./stage-seam-fixture.js";

vi.mock("../src/provider-call.js", () => ({ reviewKnowledgeJson: vi.fn() }));
vi.mock(
  "../src/workforce.js",
  async () => (await import("./stage-seam-fixture.js")).workforceSeam.module,
);

const fixtures: Awaited<ReturnType<typeof fixture>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(reviewKnowledgeJson).mockReset();
  workforceSeam.reset();
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
  workforceSeam.delegation = f.delegation;
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
  expect(baseline.debtCounts.canonicalization).toBe(Object.keys(sources).length);
  const state = obligationInput("kconv_candidate_resolution", baseline);
  const context = seamContext(f.storage);
  vi.mocked(reviewKnowledgeJson).mockImplementation(async (input) => {
    // ADR-0604: the reviewer answers from its view, citing each candidate by reference.
    const { candidates } = input.untrustedSourceData as {
      candidates: { candidate: string; sourcePath: string }[];
    };
    return {
      value: {
        decisions: candidates.map((candidate) => ({
          candidate: candidate.candidate,
          sourcePath: candidate.sourcePath,
          decision: "reject",
          rationale: RATIONALE,
          target: null,
          targetPath: null,
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
  return vi.mocked(reviewKnowledgeJson).mock.calls.map(
    ([input]) =>
      (
        input.untrustedSourceData as {
          candidates: { candidate: string; sourceBindings: { path: string }[] }[];
        }
      ).candidates,
  );
}

it("independently closes an old exact candidate and never repeats its transition after an interrupted settlement", async () => {
  const { f, state, resolveFrom } = await candidates({
    "src.ts": "export const localRuntime = true;\n",
  });
  const reviewed = (await resolveFrom(state))!;
  expect(reviewed).toMatchObject({ state: "current", nextStage: "lifecycle_verification" });
  expect(reviewed.input.stageData.candidateReview).toMatchObject({
    reviewerAgentId: "agt_seam_reviewer",
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
  expect(
    (await discoverConvergenceBaseline(f.root, f.events, f.artifacts)).debtCounts.canonicalization,
  ).toBe(0);
});

it("refuses to apply a candidate review with the reviewer's own agent", async () => {
  const { f, state, resolveFrom } = await candidates({
    "src.ts": "export const localRuntime = true;\n",
  });
  workforceSeam.sharedAgent = true;
  const reviewed = (await resolveFrom(state))!;
  const transition = vi.spyOn(knowledge, "transitionCanonicalizationCandidate");
  await expect(resolveFrom(reviewed.input)).rejects.toMatchObject({
    code: "knowledge_authority_unavailable",
  });
  expect(transition).not.toHaveBeenCalled();
  expect((await listCanonicalizationCandidates(f.root))[0]!.state).not.toBe("rejected");
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
    [expect.objectContaining({ candidate: "k1" })],
    [expect.objectContaining({ candidate: "k1" })],
  ]);
  // Each review saw a different candidate, told apart by its source bindings.
  expect(
    new Set(reviews.map(([candidate]) => JSON.stringify(candidate!.sourceBindings))).size,
  ).toBe(2);
  expect(JSON.stringify(reviews)).not.toContain("kcanon_");
});
