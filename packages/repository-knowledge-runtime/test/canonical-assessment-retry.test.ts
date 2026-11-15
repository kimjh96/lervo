import { rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { sha256 } from "@lervo/repository-knowledge";
import { assessCanonicalBaseline } from "../src/canonical-assessment.js";
import { discoverConvergenceBaseline } from "../src/baseline.js";
import { KnowledgeConvergenceRuntimeError } from "../src/failure.js";
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
  vi.mocked(reviewKnowledgeJson).mockReset();
  workforceSeam.reset();
  for (const f of fixtures.splice(0)) {
    await f.storage.close();
    await rm(f.directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

const SOURCE = "observed.ts";
const RATIONALE =
  "This exact source preserves the existing local runtime contract. No new durable fact or behavioral obligation requires a canonical change.";

async function assessment() {
  const f = await fixture(true);
  fixtures.push(f);
  workforceSeam.delegation = f.delegation;
  await writeFile(resolve(f.root, SOURCE), "export const observed = true;\n");
  const baseline = await discoverConvergenceBaseline(f.root, f.events, f.artifacts);
  baseline.assessmentPaths = [SOURCE];
  const state = obligationInput("kconv_canonical_assessment_retry", baseline);
  const context = seamContext(f.storage);
  const source = baseline.sources.find((item) => item.path === SOURCE)!;
  return {
    context,
    state,
    source,
    assess: () => assessCanonicalBaseline(context, state, () => {}),
  };
}

/** Each queued answer is one provider observation; `false` copies a wrong source hash. */
function provider(answers: (boolean | Error)[]) {
  let call = 0;
  vi.mocked(reviewKnowledgeJson).mockImplementation(async (input) => {
    const answer = answers[call++];
    if (answer instanceof Error) throw answer;
    const { sources } = input.untrustedSourceData as {
      sources: { path: string; contentHash: string }[];
    };
    return {
      value: {
        decisions: sources.map((source, index) => ({
          path: source.path,
          contentHash: answer || index > 0 ? source.contentHash : sha256("wrong source bytes"),
          disposition: "no_change",
          rationale: RATIONALE,
          canonicalReferences: [],
        })),
        drafts: [],
      },
      usage: { fixture: true },
      admissionObservationHash: sha256(`admission-${call}`),
      observationArtifactHash: sha256(`observation-${call}`),
    };
  });
}

it("retries an invalid canonical assessment once without accepting its source hash", async () => {
  const { assess, source } = await assessment();
  provider([false, true]);
  const result = await assess();
  expect(result).toMatchObject({
    state: "current",
    nextStage: "canonical_review",
    failureCode: null,
  });
  expect(reviewKnowledgeJson).toHaveBeenCalledTimes(2);
  const [first, retry] = vi.mocked(reviewKnowledgeJson).mock.calls.map(([input]) => input);
  // The retry spends the same durable batch budget instead of opening a new one.
  expect(retry!.budget).toEqual(first!.budget);
  expect(retry!.prompt).toContain("The previous response failed the exact assessment contract.");
  expect(retry!.untrustedSourceData).toHaveProperty("existingDraftTargets");
  expect(
    (
      result.input.stageData.canonicalBatch as {
        assessment: { decisions: { path: string; contentHash: string }[] };
      }
    ).assessment.decisions,
  ).toEqual([expect.objectContaining({ path: SOURCE, contentHash: source.contentHash })]);
});

it("rejects a repeated invalid canonical assessment with the retry's observation as evidence", async () => {
  const { assess } = await assessment();
  provider([false, false]);
  await expect(assess()).rejects.toMatchObject({
    code: "knowledge_semantic_review_invalid",
    dependencyHash: sha256("observation-2"),
  });
  expect(reviewKnowledgeJson).toHaveBeenCalledTimes(2);
});

it("keeps the original invalid assessment when the batch budget refuses the retry", async () => {
  const { assess } = await assessment();
  provider([false, new KnowledgeConvergenceRuntimeError("normalization_budget_exceeded")]);
  await expect(assess()).rejects.toMatchObject({
    code: "knowledge_semantic_review_invalid",
    dependencyHash: sha256("observation-1"),
  });
  expect(reviewKnowledgeJson).toHaveBeenCalledTimes(2);
});
