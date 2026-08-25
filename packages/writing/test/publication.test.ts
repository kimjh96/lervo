import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import { defaultEnglishWritingContract } from "@lervo/core";
import type { WritingContract } from "@lervo/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  evaluateWritingPublication,
  readPublishableWritingArtifact,
  type WritingArtifactCoordinate,
  type WritingSemanticEvaluator,
} from "../src/index.js";

const roots: string[] = [];
const checkedAt = new Date("2026-08-19T00:00:00Z");

async function openCas(): Promise<FileSystemCas> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-writing-"));
  roots.push(root);
  return FileSystemCas.open(root);
}

async function storeWriting(
  store: FileSystemCas,
  content: string,
): Promise<WritingArtifactCoordinate> {
  const bytes = Buffer.from(content, "utf8");
  const stored = await store.put(bytes);
  return {
    artifactId: `art_${stored.contentHash.slice(7)}`,
    uri: stored.uri,
    mediaType: "text/markdown; charset=utf-8",
    contentHash: stored.contentHash,
    byteCount: bytes.byteLength,
  };
}

function passingEvaluator(): WritingSemanticEvaluator {
  return {
    async evaluate(request) {
      return {
        evaluator: { kind: "model", evaluatorId: "fixture.korean-review.v1" },
        checks: request.checks.map((check) => ({
          checkId: check.checkId,
          status: "passed" as const,
          violationCount: 0,
        })),
      };
    },
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("writing publication boundary", () => {
  it("publishes only after separate semantic checks and revalidates the stored permit", async () => {
    const store = await openCas();
    const evaluate = vi.fn(passingEvaluator().evaluate);
    const artifact = await storeWriting(
      store,
      "The task is complete. The change scope and verification result were checked together.",
    );
    const result = await evaluateWritingPublication(
      {
        artifact,
        contract: defaultEnglishWritingContract,
        surface: "chat",
        artifactStore: store,
        semanticEvaluator: { evaluate },
      },
      { now: () => checkedAt },
    );

    expect(result.status).toBe("allowed");
    if (result.status !== "allowed") throw new Error("expected allowed result");
    expect(result.semanticEvaluationStatus).toBe("completed");
    expect(result.evaluation.overallStatus).toBe("passed");
    expect(result.evaluation.evaluators).toContainEqual({
      kind: "model",
      evaluatorId: "fixture.korean-review.v1",
      phase: "separate_pass",
    });
    expect(evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ audience: "mixed", register: "plain_spec" }),
    );
    expect(await store.has(result.evaluationArtifact.uri)).toBe(true);
    await expect(
      readPublishableWritingArtifact({
        artifact,
        evaluation: result.evaluation,
        evaluationArtifact: result.evaluationArtifact,
        permit: result.permit,
        contract: defaultEnglishWritingContract,
        surface: "chat",
        artifactStore: store,
      }),
    ).resolves.toBe(result.content);
  });

  it("fails closed when no semantic evaluator is available", async () => {
    const store = await openCas();
    const artifact = await storeWriting(store, "The task is complete.");
    const result = await evaluateWritingPublication(
      { artifact, contract: defaultEnglishWritingContract, surface: "chat", artifactStore: store },
      { now: () => checkedAt },
    );

    expect(result).toMatchObject({
      status: "blocked",
      failure: "writing_verification_failed",
      permit: null,
      content: null,
      semanticEvaluationStatus: "not_run",
    });
    expect(result.missingChecks).toContain("semantic_evaluator");
    expect(result.evaluation.overallStatus).toBe("incomplete");
  });

  it("rejects an empty writing artifact before any semantic evaluation", async () => {
    const store = await openCas();
    const artifact = await storeWriting(store, "");
    const evaluate = vi.fn(passingEvaluator().evaluate);

    await expect(
      evaluateWritingPublication({
        artifact,
        contract: defaultEnglishWritingContract,
        surface: "chat",
        artifactStore: store,
        semanticEvaluator: { evaluate },
      }),
    ).rejects.toMatchObject({ code: "artifact_contract_invalid" });
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("does not call the semantic evaluator when deterministic checks fail", async () => {
    const store = await openCas();
    const artifact = await storeWriting(store, "The user must check this — obviously.");
    const evaluate = vi.fn(passingEvaluator().evaluate);
    const result = await evaluateWritingPublication(
      {
        artifact,
        contract: defaultEnglishWritingContract,
        surface: "chat",
        artifactStore: store,
        semanticEvaluator: { evaluate },
      },
      { now: () => checkedAt },
    );

    expect(evaluate).not.toHaveBeenCalled();
    expect(result.status).toBe("blocked");
    expect(result.failedChecks).toEqual(
      expect.arrayContaining([
        "forbid_em_dash",
        "forbid_abstract_action_subject",
        "forbid_vague_terms",
      ]),
    );
  });

  it("records an invalid separate response as incomplete without exposing content", async () => {
    const store = await openCas();
    const artifact = await storeWriting(store, "The task is complete.");
    const result = await evaluateWritingPublication(
      {
        artifact,
        contract: defaultEnglishWritingContract,
        surface: "chat",
        artifactStore: store,
        semanticEvaluator: {
          async evaluate(request) {
            const check = request.checks[0]!;
            return {
              evaluator: { kind: "model", evaluatorId: "fixture.invalid.v1" },
              checks: [
                { checkId: check.checkId, status: "passed", violationCount: 0 },
                { checkId: check.checkId, status: "passed", violationCount: 0 },
              ],
            };
          },
        },
      },
      { now: () => checkedAt },
    );

    expect(result).toMatchObject({
      status: "blocked",
      content: null,
      semanticEvaluationStatus: "invalid",
    });
    expect(result.evaluation.checks.filter((check) => check.kind === "semantic")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "not_run", evidenceDigest: null }),
      ]),
    );
  });

  it("turns a structurally malformed evaluator response into an invalid attempt", async () => {
    const store = await openCas();
    const artifact = await storeWriting(store, "The task is complete.");
    const result = await evaluateWritingPublication(
      {
        artifact,
        contract: defaultEnglishWritingContract,
        surface: "chat",
        artifactStore: store,
        semanticEvaluator: {
          evaluate: async () => undefined as never,
        },
      },
      { now: () => checkedAt },
    );

    expect(result).toMatchObject({
      status: "blocked",
      content: null,
      semanticEvaluationStatus: "invalid",
    });
  });

  it("rejects reuse for another surface, policy body, or content artifact", async () => {
    const store = await openCas();
    const artifact = await storeWriting(store, "The task is complete.");
    const result = await evaluateWritingPublication(
      {
        artifact,
        contract: defaultEnglishWritingContract,
        surface: "chat",
        artifactStore: store,
        semanticEvaluator: passingEvaluator(),
      },
      { now: () => checkedAt },
    );
    if (result.status !== "allowed") throw new Error("expected allowed result");
    const base = {
      artifact,
      evaluation: result.evaluation,
      evaluationArtifact: result.evaluationArtifact,
      permit: result.permit,
      contract: defaultEnglishWritingContract as WritingContract,
      surface: "chat" as const,
      artifactStore: store,
    };

    await expect(
      readPublishableWritingArtifact({ ...base, surface: "documentation" }),
    ).rejects.toMatchObject({ code: "publication_permit_invalid" });
    const changedPolicy = structuredClone(defaultEnglishWritingContract) as WritingContract;
    changedPolicy.terminology.forbiddenVagueTerms.push("roughly");
    await expect(
      readPublishableWritingArtifact({ ...base, contract: changedPolicy }),
    ).rejects.toMatchObject({ code: "publication_permit_invalid" });
    const otherArtifact = await storeWriting(store, "A different result.");
    await expect(
      readPublishableWritingArtifact({ ...base, artifact: otherArtifact }),
    ).rejects.toMatchObject({ code: "publication_permit_invalid" });
  });

  it("treats an evaluator exception as a failed attempt without persisting its error text", async () => {
    const store = await openCas();
    const artifact = await storeWriting(store, "The task is complete.");
    const result = await evaluateWritingPublication(
      {
        artifact,
        contract: defaultEnglishWritingContract,
        surface: "chat",
        artifactStore: store,
        semanticEvaluator: {
          evaluate: async () => {
            throw new Error("private evaluator detail");
          },
        },
      },
      { now: () => checkedAt },
    );

    expect(result).toMatchObject({
      status: "blocked",
      semanticEvaluationStatus: "failed",
      content: null,
    });
    expect(JSON.stringify(result.evaluation)).not.toContain("private evaluator detail");
  });
});
