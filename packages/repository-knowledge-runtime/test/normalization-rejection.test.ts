import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import {
  compileConfiguredDocumentNormalizationCandidate,
  sha256,
  type DocumentNormalizationCandidate,
  type DocumentNormalizationEnvelope,
  type KnowledgeConvergenceInput,
  type RepositoryDocumentNormalizationCompiler,
} from "@lervo/repository-knowledge";

import { parseNormalizationSemanticReview } from "../src/normalization-review.js";
import {
  normalizationRejections,
  recordNormalizationRejections,
} from "../src/normalization-rejection.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

/** The identity normalizer the convergence fixture provider also uses: outputs keep source bytes. */
const compiler: RepositoryDocumentNormalizationCompiler = {
  descriptor: {
    compilerId: "lervo.fixture.rejection-normalizer",
    compilerVersion: "1",
    compilerBuildId: sha256("rejection-normalizer"),
    provider: "claude",
    isolation: "external_no_capabilities",
  },
  async normalize(envelope: DocumentNormalizationEnvelope) {
    return {
      schemaVersion: 1,
      documents: envelope.documents.map((document) => ({
        sourcePath: document.path,
        outputs: [
          {
            path: document.path,
            content: document.untrustedSourceData,
            coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index),
          },
        ],
      })),
      telemetry: {
        filesystemReads: 0,
        filesystemWrites: 0,
        shellProcesses: 0,
        networkRequests: 0,
        externalActions: 0,
        toolCalls: 0,
        complete: true,
      },
    };
  },
};

async function repository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-normalization-rejection-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_normalization_rejection" }));
  await mkdir(resolve(root, "docs/specs"), { recursive: true });
  await writeFile(resolve(root, "docs/specs/a.md"), "# A\n\nKeep this local contract.\n");
  await writeFile(resolve(root, "docs/specs/b.md"), "# B\n\nThe runtime works without a Hub.\n");
  return root;
}

/**
 * A real candidate, compiled by the product from the repository's exact bytes for the selected
 * sources, as the generation stage compiles one batch.
 */
function candidateFor(root: string) {
  return compileConfiguredDocumentNormalizationCandidate({
    repositoryRoot: root,
    compiler,
    signal: new AbortController().signal,
    sourcePaths: ["docs/specs/a.md", "docs/specs/b.md"],
  });
}

const CHECKS = [
  "meaning",
  "requirements",
  "examples",
  "links",
  "lifecycle",
  "protectedRegions",
  "skillIdentity",
  "resources",
];

/**
 * The reviewer's raw response, parsed by the same validator the review stage uses. Each rejected
 * path names its rationale and failed checks; every other item is approved with full coverage.
 */
function review(
  candidate: DocumentNormalizationCandidate,
  rejected: Record<string, { rationale: string; failed: string[] }>,
) {
  return parseNormalizationSemanticReview(
    {
      candidateId: candidate.candidateId,
      decisions: candidate.items.map((item) => {
        const rejection = rejected[item.sourcePath];
        return {
          operationId: item.operationId,
          sourceContentHash: item.sourceContentHash,
          decision: rejection === undefined ? "approve" : "reject",
          rationale:
            rejection?.rationale ??
            "The exact source and all output bytes preserve every requirement and link.",
          checks: Object.fromEntries(
            CHECKS.map((check) => [check, !rejection?.failed.includes(check)]),
          ),
          unitReviews: item.sourceUnitVersionIds.map((id) => ({
            unitVersionId: id,
            outputHashes: item.outputs
              .filter((output) => output.coveredUnitVersionIds.includes(id))
              .map((output) => output.contentHash),
            rationale: "This exact source unit is preserved in the output bytes.",
          })),
        };
      }),
    },
    candidate,
  );
}

/** The stage data the review stage wrote, as the next stage of the obligation reads it back. */
const stored = (records: unknown) =>
  normalizationRejections({
    stageData: { normalizationRejections: records },
  } as unknown as KnowledgeConvergenceInput);

const LINK = "The link to runtime.md#local-runtime loses its anchor in this rewrite.";
const MEANING = "The rewrite drops the local contract sentence and changes its meaning.";

it("counts rejected generations per exact bytes with the latest reviewer reasons", async () => {
  const root = await repository();
  const candidate = await candidateFor(root);
  expect(candidate.items.map((item) => item.sourcePath)).toEqual([
    "docs/specs/a.md",
    "docs/specs/b.md",
  ]);
  const a = candidate.items[0]!.sourceContentHash;

  // Only the rejected item is recorded; the approved sibling in the same batch is not.
  const first = recordNormalizationRejections(
    stored(undefined),
    candidate,
    review(candidate, { "docs/specs/a.md": { rationale: LINK, failed: ["links"] } }),
  );
  expect(first).toEqual({
    "docs/specs/a.md": {
      contentHash: a,
      attempts: 1,
      reasons: [`${LINK} (failed checks: links)`],
    },
  });

  // The same bytes rejected again count a second attempt and keep only the latest reasons.
  const second = recordNormalizationRejections(
    stored(first),
    candidate,
    review(candidate, {
      "docs/specs/a.md": { rationale: MEANING, failed: ["meaning", "requirements"] },
    }),
  );
  expect(second).toEqual({
    "docs/specs/a.md": {
      contentHash: a,
      attempts: 2,
      reasons: [`${MEANING} (failed checks: meaning, requirements)`],
    },
  });

  // An approval leaves an earlier record untouched; a rejection without a failed check keeps the
  // rationale alone, and records stay ordered by path.
  const third = recordNormalizationRejections(
    stored(second),
    candidate,
    review(candidate, { "docs/specs/b.md": { rationale: MEANING, failed: [] } }),
  );
  expect(Object.keys(third)).toEqual(["docs/specs/a.md", "docs/specs/b.md"]);
  expect(third).toEqual({
    "docs/specs/a.md": second["docs/specs/a.md"],
    "docs/specs/b.md": {
      contentHash: candidate.items[1]!.sourceContentHash,
      attempts: 1,
      reasons: [MEANING],
    },
  });
});

it("restarts the attempt count when the rejected document has new bytes", async () => {
  const root = await repository();
  const original = await candidateFor(root);
  const first = recordNormalizationRejections(
    stored(undefined),
    original,
    review(original, { "docs/specs/a.md": { rationale: LINK, failed: ["links"] } }),
  );
  const second = recordNormalizationRejections(
    stored(first),
    original,
    review(original, { "docs/specs/a.md": { rationale: LINK, failed: ["links"] } }),
  );
  expect(second["docs/specs/a.md"]!.attempts).toBe(2);

  await writeFile(resolve(root, "docs/specs/a.md"), "# A\n\nKeep this exact local contract.\n");
  const edited = await candidateFor(root);
  const editedHash = edited.items.find(
    (item) => item.sourcePath === "docs/specs/a.md",
  )!.sourceContentHash;
  expect(editedHash).not.toBe(first["docs/specs/a.md"]!.contentHash);
  expect(
    recordNormalizationRejections(
      stored(second),
      edited,
      review(edited, { "docs/specs/a.md": { rationale: MEANING, failed: ["meaning"] } }),
    ),
  ).toEqual({
    "docs/specs/a.md": {
      contentHash: editedHash,
      attempts: 1,
      reasons: [`${MEANING} (failed checks: meaning)`],
    },
  });
});
