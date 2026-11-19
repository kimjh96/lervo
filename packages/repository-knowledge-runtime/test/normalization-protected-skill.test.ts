import { expect, it, vi } from "vitest";

import type { KnowledgeConvergenceInput } from "@lervo/repository-knowledge";

const skill = ".agents/skills/deploy-lervo-release/SKILL.md";

vi.mock("@lervo/repository-knowledge", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lervo/repository-knowledge")>()),
  // An earlier normalization record makes the skill look pending, as on main since 2026-11-14.
  inspectConfiguredDocumentNormalization: async () => ({
    schemaVersion: 1,
    outputLanguage: "en",
    formatVersion: "lervo.document.v1",
    eligibleDocuments: 1,
    currentDocuments: 0,
    pendingDocuments: [skill],
    records: [],
  }),
}));

const { generateNormalizationBatch } = await import("../src/normalization-generation.js");

// ADR-0594: when a protected skill is the only pending document, normalization generation does
// not wait "outside delegation"; it completes so normalization review and verification still run.
it("never lets a protected skill hold the stages after normalization generation", async () => {
  const snapshotHash = `sha256:${"a".repeat(64)}`;
  const capture = { snapshotHash, sources: [], head: undefined };
  const state = {
    schemaVersion: 1,
    obligationId: "kconv_0123456789abcdef01234567",
    snapshotHash,
    receipts: [],
    baseline: {
      projectId: "prj_protected_skill",
      policyHash: `sha256:${"b".repeat(64)}`,
      delegationHash: `sha256:${"c".repeat(64)}`,
      sources: [{ path: skill, contentHash: `sha256:${"d".repeat(64)}`, kind: "text" }],
    },
    stageData: {},
  } as unknown as KnowledgeConvergenceInput;
  const result = await generateNormalizationBatch(
    {
      storage: {
        paths: { repositoryRoot: "/repository" },
        events: { list: () => [] },
        artifacts: { put: async () => ({ contentHash: `sha256:${"e".repeat(64)}` }) },
      },
      sourceObservation: { exact: () => capture, current: () => capture, noteChange: () => {} },
      provider: "codex",
      signal: new AbortController().signal,
      liveWorkPending: async () => false,
      assertSourceExact: () => undefined,
      assertSourceCurrent: () => undefined,
    } as never,
    state,
    () => undefined,
  );
  expect(result).toMatchObject({ state: "current", nextStage: "normalization_review" });
});
