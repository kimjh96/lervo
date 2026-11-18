import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assessCanonicalization,
  canonicalizationCandidateHeld,
  listCanonicalizationCandidates,
  reopenCanonicalizationCandidate,
  sha256,
  transitionCanonicalizationCandidate,
} from "../src/index.js";

const roots: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-canonicalization-"));
  roots.push(root);
  await mkdir(resolve(root, "packages/core/src"), { recursive: true });
  await mkdir(resolve(root, "docs/specs"), { recursive: true });
  await writeFile(resolve(root, "packages/core/src/value.ts"), "export const value = 2;\n");
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("typed canonicalization candidates", () => {
  it("registers, reviews, promotes, rejects, and observes staleness without lexical routing", async () => {
    const root = await repository();
    const sourceHash = sha256("export const value = 2;\n");
    const assessment = await assessCanonicalization({
      repositoryRoot: root,
      beforeRevision: sha256("before"),
      afterRevision: sha256("after"),
      beforeFiles: { "packages/core/src/value.ts": sha256("export const value = 1;\n") },
      afterFiles: { "packages/core/src/value.ts": sourceHash },
      disposition: "canonical_sources_current",
      now: new Date("2026-08-30T00:00:00.000Z"),
    });

    expect(assessment).toMatchObject({
      status: "candidate",
      changedPathCount: 1,
      canonicalPathCount: 0,
      candidate: {
        state: "candidate",
        observedState: "candidate",
        sourceBindings: [
          {
            path: "packages/core/src/value.ts",
            responsibility: "architecture_or_specification",
          },
        ],
        recommendedRoots: ["docs/specs"],
      },
    });
    expect(JSON.stringify(assessment)).not.toMatch(/keyword|prompt|phrase/iu);

    const pending = await transitionCanonicalizationCandidate({
      repositoryRoot: root,
      candidateId: assessment.candidate!.candidateId,
      expectedContentHash: assessment.candidate!.contentHash,
      action: "defer",
      reviewerId: "reviewer.one",
      now: new Date("2026-08-30T00:01:00.000Z"),
    });
    expect(pending.observedState).toBe("pending");
    // ADR-0561: a reviewer's deferral is held as Lervo debt, and reopen undoes any decision.
    expect(canonicalizationCandidateHeld(pending)).toBe(true);
    const reopened = await reopenCanonicalizationCandidate({
      repositoryRoot: root,
      candidateId: pending.candidateId,
    });
    expect(reopened).toMatchObject({ observedState: "candidate", review: null, promotion: null });
    expect(canonicalizationCandidateHeld(reopened)).toBe(false);
    await expect(
      reopenCanonicalizationCandidate({ repositoryRoot: root, candidateId: pending.candidateId }),
    ).rejects.toMatchObject({ code: "knowledge_plan_stale" });
    const deferredAgain = await transitionCanonicalizationCandidate({
      repositoryRoot: root,
      candidateId: reopened.candidateId,
      expectedContentHash: reopened.contentHash,
      action: "defer",
      reviewerId: "reviewer.one",
      now: new Date("2026-08-30T00:01:30.000Z"),
    });

    await writeFile(
      resolve(root, "docs/specs/value.md"),
      "# Value\n\nThe value contract is two.\n",
    );
    const targetHash = sha256(await readFile(resolve(root, "docs/specs/value.md")));
    const promoted = await transitionCanonicalizationCandidate({
      repositoryRoot: root,
      candidateId: deferredAgain.candidateId,
      expectedContentHash: deferredAgain.contentHash,
      action: "promote",
      reviewerId: "reviewer.one",
      targetPath: "docs/specs/value.md",
      targetContentHash: targetHash,
      now: new Date("2026-08-30T00:02:00.000Z"),
    });
    expect(promoted).toMatchObject({
      observedState: "promoted",
      promotion: { reviewerId: "reviewer.one", targetPath: "docs/specs/value.md" },
    });

    const rejectedAssessment = await assessCanonicalization({
      repositoryRoot: root,
      beforeRevision: sha256("before-reject"),
      afterRevision: sha256("after-reject"),
      beforeFiles: { "packages/core/src/value.ts": sourceHash },
      afterFiles: { "packages/core/src/value.ts": sha256("export const value = 3;\n") },
      disposition: "pending_user_approval",
      now: new Date("2026-08-30T00:03:00.000Z"),
    });
    await writeFile(resolve(root, "packages/core/src/value.ts"), "export const value = 3;\n");
    const refreshed = (await listCanonicalizationCandidates(root)).find(
      (item) => item.candidateId === rejectedAssessment.candidate!.candidateId,
    )!;
    const rejected = await transitionCanonicalizationCandidate({
      repositoryRoot: root,
      candidateId: refreshed.candidateId,
      expectedContentHash: refreshed.contentHash,
      action: "reject",
      reviewerId: "reviewer.two",
      now: new Date("2026-08-30T00:04:00.000Z"),
    });
    expect(rejected.observedState).toBe("rejected");

    const staleAssessment = await assessCanonicalization({
      repositoryRoot: root,
      beforeRevision: sha256("before-stale"),
      afterRevision: sha256("after-stale"),
      beforeFiles: { "packages/core/src/value.ts": sha256("export const value = 3;\n") },
      afterFiles: { "packages/core/src/value.ts": sha256("export const value = 4;\n") },
      disposition: "canonical_sources_current",
      now: new Date("2026-08-30T00:05:00.000Z"),
    });
    await writeFile(resolve(root, "packages/core/src/value.ts"), "export const value = 5;\n");
    expect(
      (await listCanonicalizationCandidates(root)).find(
        (item) => item.candidateId === staleAssessment.candidate!.candidateId,
      )?.observedState,
    ).toBe("stale");

    const stale = (await listCanonicalizationCandidates(root)).find(
      (item) => item.candidateId === staleAssessment.candidate!.candidateId,
    )!;
    await expect(
      transitionCanonicalizationCandidate({
        repositoryRoot: root,
        candidateId: stale.candidateId,
        expectedContentHash: stale.contentHash,
        action: "promote",
        reviewerId: "reviewer.three",
        targetPath: "docs/specs/value.md",
        targetContentHash: targetHash,
        now: new Date("2026-08-30T00:06:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "knowledge_plan_stale" });
    const retired = await transitionCanonicalizationCandidate({
      repositoryRoot: root,
      candidateId: stale.candidateId,
      expectedContentHash: stale.contentHash,
      action: "reject",
      reviewerId: "reviewer.three",
      now: new Date("2026-08-30T00:07:00.000Z"),
    });
    expect(retired).toMatchObject({
      state: "rejected",
      observedState: "rejected",
      review: { reviewerId: "reviewer.three", decision: "reject" },
    });
  });

  it("reports current when a matching typed canonical source changes in the same turn", async () => {
    const root = await repository();
    const assessment = await assessCanonicalization({
      repositoryRoot: root,
      beforeRevision: sha256("before-current"),
      afterRevision: sha256("after-current"),
      beforeFiles: {
        "packages/core/src/value.ts": sha256("source-before"),
        "docs/specs/value.md": sha256("spec-before"),
      },
      afterFiles: {
        "packages/core/src/value.ts": sha256("source-after"),
        "docs/specs/value.md": sha256("spec-after"),
      },
      disposition: "canonical_sources_updated",
      now: new Date("2026-08-30T00:00:00.000Z"),
    });
    expect(assessment).toEqual({
      schemaVersion: 1,
      status: "current",
      changedPathCount: 2,
      canonicalPathCount: 1,
      candidate: null,
    });
  });

  it("assesses large canonicalized changes without expanding candidate evidence", async () => {
    const root = await repository();
    const sourcePaths = Object.fromEntries(
      Array.from({ length: 300 }, (_, index) => [
        `packages/example-${index}/src/index.ts`,
        sha256(`source-${index}`),
      ]),
    );
    const assessment = await assessCanonicalization({
      repositoryRoot: root,
      beforeRevision: sha256("before-large-current"),
      afterRevision: sha256("after-large-current"),
      beforeFiles: {
        ...sourcePaths,
        "docs/specs/large-change.md": sha256("spec-before"),
      },
      afterFiles: {
        ...Object.fromEntries(
          Object.keys(sourcePaths).map((path, index) => [path, sha256(`updated-${index}`)]),
        ),
        "docs/specs/large-change.md": sha256("spec-after"),
      },
      disposition: "canonical_sources_updated",
      now: new Date("2026-09-04T00:00:00.000Z"),
    });
    expect(assessment).toEqual({
      schemaVersion: 1,
      status: "current",
      changedPathCount: 301,
      canonicalPathCount: 1,
      candidate: null,
    });
  });

  it("keeps noncanonical candidate evidence bounded independently of changed path count", async () => {
    const root = await repository();
    const beforeFiles = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [
        `packages/example-${index}/src/index.ts`,
        sha256(`before-${index}`),
      ]),
    );
    const afterFiles = Object.fromEntries(
      Object.keys(beforeFiles).map((path, index) => [path, sha256(`after-${index}`)]),
    );
    await expect(
      assessCanonicalization({
        repositoryRoot: root,
        beforeRevision: sha256("before-large-candidate"),
        afterRevision: sha256("after-large-candidate"),
        beforeFiles,
        afterFiles,
        disposition: "canonical_sources_current",
        now: new Date("2026-09-04T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "knowledge_source_limit_exceeded" });
  });

  it("promotes a provider-surface obligation only after it is written to a canonical instruction route", async () => {
    const root = await repository();
    await writeFile(resolve(root, "CLAUDE.md"), "Follow the repository commit policy.\n");
    const assessment = await assessCanonicalization({
      repositoryRoot: root,
      beforeRevision: sha256("instruction-before"),
      afterRevision: sha256("instruction-after"),
      beforeFiles: {},
      afterFiles: { "CLAUDE.md": sha256("Follow the repository commit policy.\n") },
      disposition: "pending_user_approval",
      now: new Date("2026-08-30T00:00:00.000Z"),
    });
    expect(assessment.candidate).toMatchObject({
      observedState: "candidate",
      recommendedRoots: ["docs/instructions"],
      sourceBindings: [{ responsibility: "behavioral_instruction" }],
    });

    await mkdir(resolve(root, "docs/instructions"), { recursive: true });
    await writeFile(
      resolve(root, "docs/instructions/commit-policy.md"),
      "# Commit policy\n\nUse the repository commit convention.\n",
    );
    await writeFile(
      resolve(root, "AGENTS.md"),
      "# Agent instructions\n\nRead [the commit policy](docs/instructions/commit-policy.md).\n",
    );
    const targetHash = sha256(await readFile(resolve(root, "docs/instructions/commit-policy.md")));
    const promoted = await transitionCanonicalizationCandidate({
      repositoryRoot: root,
      candidateId: assessment.candidate!.candidateId,
      expectedContentHash: assessment.candidate!.contentHash,
      action: "promote",
      reviewerId: "instruction.owner",
      targetPath: "docs/instructions/commit-policy.md",
      targetContentHash: targetHash,
      now: new Date("2026-08-30T00:01:00.000Z"),
    });
    expect(promoted).toMatchObject({
      observedState: "promoted",
      promotion: {
        reviewerId: "instruction.owner",
        targetPath: "docs/instructions/commit-policy.md",
        targetContentHash: targetHash,
      },
    });
    expect(await readFile(resolve(root, "docs/instructions/commit-policy.md"), "utf8")).toContain(
      "repository commit convention",
    );
    expect(await readFile(resolve(root, "AGENTS.md"), "utf8")).toContain(
      "docs/instructions/commit-policy.md",
    );
  });
});
