import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  compileConfiguredDocumentNormalizationCandidateObserved,
  sha256,
  type DocumentNormalizationEnvelope,
  type DocumentNormalizationResponse,
  type RepositoryDocumentNormalizationCompiler,
} from "../src/index.js";

const roots: string[] = [];

async function repository(documentCount: number): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-document-observation-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_document_observation",
      now: new Date("2026-09-04T00:00:00.000Z"),
    }),
  );
  await mkdir(resolve(root, "docs/operations"), { recursive: true });
  await Promise.all(
    Array.from({ length: documentCount }, (_, index) =>
      writeFile(
        resolve(root, `docs/operations/guide-${index}.md`),
        `# Guide ${index}\n\nKeep this guide current.\n`,
      ),
    ),
  );
  return root;
}

function response(envelope: DocumentNormalizationEnvelope): DocumentNormalizationResponse {
  return {
    schemaVersion: 1,
    documents: envelope.documents.map((document) => ({
      sourcePath: document.path,
      outputs: [
        {
          path: document.path,
          content: `# Normalized ${document.path}\n`,
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
}

function compiler(calls: string[][]): RepositoryDocumentNormalizationCompiler {
  return {
    descriptor: {
      compilerId: "lervo.fixture.observed-normalizer",
      compilerVersion: "1",
      compilerBuildId: sha256("observed-normalizer"),
      provider: "codex",
      isolation: "external_no_capabilities",
    },
    async normalize() {
      throw new Error("the observed compiler boundary was bypassed");
    },
    async normalizeObserved(envelope) {
      calls.push(envelope.documents.map((document) => document.path));
      return {
        response: response(envelope),
        tokenUsage: {
          status: "observed",
          inputTokens: 8,
          cachedInputTokens: 2,
          outputTokens: 2,
          totalTokens: 10,
        },
      };
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("observed document normalization compilation", () => {
  it("aggregates provider usage while attributing cache reuse to zero new calls", async () => {
    const root = await repository(3);
    const calls: string[][] = [];
    const normalizer = compiler(calls);
    const first = await compileConfiguredDocumentNormalizationCandidateObserved({
      repositoryRoot: root,
      compiler: normalizer,
      signal: new AbortController().signal,
      ceilings: { maximumObservedTokens: 100, maximumElapsedMilliseconds: 10_000 },
    });

    expect(first.candidate.items).toHaveLength(3);
    expect(first.resourceObservation).toMatchObject({
      providerCalls: 2,
      tokenUsage: {
        status: "observed",
        inputTokens: 16,
        cachedInputTokens: 4,
        outputTokens: 4,
        totalTokens: 20,
      },
    });
    expect(first.resourceObservation.elapsedMilliseconds).toBeGreaterThanOrEqual(0);
    expect(calls).toHaveLength(2);

    calls.length = 0;
    const cached = await compileConfiguredDocumentNormalizationCandidateObserved({
      repositoryRoot: root,
      compiler: normalizer,
      signal: new AbortController().signal,
      ceilings: { maximumObservedTokens: 100, maximumElapsedMilliseconds: 10_000 },
    });
    expect(cached.candidate.candidateId).toBe(first.candidate.candidateId);
    expect(cached.resourceObservation).toEqual({
      providerCalls: 0,
      elapsedMilliseconds: 0,
      tokenUsage: {
        status: "observed",
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      },
    });
    expect(calls).toEqual([]);
  });

  it("serializes metered work and stops before the next envelope after exhaustion", async () => {
    const root = await repository(3);
    const calls: string[][] = [];

    await expect(
      compileConfiguredDocumentNormalizationCandidateObserved({
        repositoryRoot: root,
        compiler: compiler(calls),
        signal: new AbortController().signal,
        ceilings: { maximumObservedTokens: 10 },
      }),
    ).rejects.toMatchObject({ code: "normalization_budget_exceeded" });
    expect(calls).toHaveLength(1);
  });

  it("reports an explicit unavailable value for legacy compiler boundaries", async () => {
    const root = await repository(1);
    const normalizer = compiler([]);
    delete normalizer.normalizeObserved;
    normalizer.normalize = async (envelope) => response(envelope);

    const result = await compileConfiguredDocumentNormalizationCandidateObserved({
      repositoryRoot: root,
      compiler: normalizer,
      signal: new AbortController().signal,
    });

    expect(result.resourceObservation.tokenUsage).toEqual({
      status: "unavailable",
      reason: "normalization_usage_unavailable",
      observedProviderCalls: 0,
      unavailableProviderCalls: 1,
    });
  });
});
