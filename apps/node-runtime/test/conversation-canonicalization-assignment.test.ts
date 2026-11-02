import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { assessCanonicalization } from "@lervo/repository-knowledge";
import { afterEach, expect, it } from "vitest";

import {
  canonicalizationAssignment,
  normalizationAssignment,
  pendingCanonicalizationCandidates,
} from "../src/conversation-canonicalization-assignment.js";
import { executionInstructions } from "../src/conversation-repository-work-writing.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("assigns open background candidates to the next write-capable Discord turn", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-canon-assign-"));
  roots.push(root);
  await mkdir(resolve(root, "src"));
  await writeFile(resolve(root, "src/a.ts"), "export const a = 2;\n");
  const { createHash } = await import("node:crypto");
  const after = `sha256:${createHash("sha256").update("export const a = 2;\n").digest("hex")}`;
  await assessCanonicalization({
    repositoryRoot: root,
    beforeRevision: `sha256:${"1".repeat(64)}`,
    afterRevision: `sha256:${"2".repeat(64)}`,
    beforeFiles: {},
    afterFiles: { "src/a.ts": after },
    disposition: "canonical_sources_current",
    now: new Date("2026-09-25T12:00:00.000Z"),
  });
  const [candidate] = await pendingCanonicalizationCandidates(root);
  expect(candidate).toMatchObject({ state: "candidate", sourcePaths: ["src/a.ts"] });
  const instructions = executionInstructions({
    request: "Fix the typo.",
    priorTurns: [],
    durableResults: [],
    worker: { displayName: "Vero", roleId: "developer" },
    externalEffectsAuthorized: false,
    finalizationStartsAt: "2026-09-25T12:10:00.000Z",
    canonicalizationCandidates: [candidate!],
  });
  // ADR-0561: the turn documents the candidate; the background reviewer promotes or rejects it.
  expect(instructions).toContain(`- ${candidate!.candidateId}: sources src/a.ts`);
  expect(instructions).toContain("never record a promotion or rejection");
  expect(instructions).not.toContain("lervo knowledge canonicalization promote");
  expect(instructions).not.toContain("lervo knowledge canonicalization review");
  // A drifted source is the background reviewer's alone; the turn is not assigned it.
  await writeFile(resolve(root, "src/a.ts"), "export const a = 3;\n");
  expect(await pendingCanonicalizationCandidates(root)).toEqual([]);
  expect(canonicalizationAssignment([])).toBeNull();
  expect(await pendingCanonicalizationCandidates(resolve(root, "missing"))).toEqual([]);
  expect(normalizationAssignment(null)).toBeNull();
  const review = {
    pendingCount: 3,
    candidateId: `knorm_${"a".repeat(24)}`,
    planId: "knormplan_fixture",
    items: [
      {
        sourcePath: "docs/a.md",
        operationId: `knormop_${"b".repeat(24)}`,
        approvalHash: `sha256:${"c".repeat(64)}`,
      },
    ],
  };
  const assigned = executionInstructions({
    request: "Fix the typo.",
    priorTurns: [],
    durableResults: [],
    worker: null,
    externalEffectsAuthorized: false,
    finalizationStartsAt: "2026-09-25T12:10:00.000Z",
    normalizationReview: review,
  });
  expect(assigned).toContain("Document normalization debt: 3 documents await normalization");
  // The sandboxed turn applies the stored candidate after Lervo's own cross-check (ADR-0561).
  expect(assigned).toContain(
    `lervo knowledge normalize --candidate ${review.candidateId} --apply knormplan_fixture\``,
  );
  expect(assigned).not.toContain("--approve-item");
  expect(assigned).toContain("Do not run `--provider`");
});
