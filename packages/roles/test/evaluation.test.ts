import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import type { RoleEvaluationResult } from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertRoleArtifactPublishable,
  assertRoleEvaluationResult,
  createRoleEvaluationResult,
  getBuiltInRoleDefinition,
  readPublishableRoleArtifact,
} from "../src/index.js";
import { artifactId, contentHash, mediaType, observations } from "./fixtures.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("role evaluation result", () => {
  it("passes only when every role-specific check ran with evidence", () => {
    const definition = getBuiltInRoleDefinition("researcher");
    const result = createRoleEvaluationResult({
      definition,
      artifactId,
      contentHash,
      byteCount: 32,
      mediaType,
      producerRunId: "run_researcher_0001",
      evaluatedAt: "2026-08-20T01:00:00.000Z",
      observations: observations("researcher").reverse(),
    });

    expect(result.overallStatus).toBe("passed");
    expect(result.checks.map((check) => check.checkId))
      .toEqual(definition.evaluation.checks.map((check) => check.checkId));
    expect(() => assertRoleEvaluationResult({ definition, result })).not.toThrow();
    expect(() => assertRoleArtifactPublishable({
      definition,
      result,
      artifactId,
      contentHash,
    })).not.toThrow();
    expect(() => assertRoleArtifactPublishable({
      definition,
      result,
      artifactId,
      contentHash: `sha256:${"e".repeat(64)}`,
    })).toThrow(/published/);
  });

  it("keeps failed and not-run checks distinct and never promotes incomplete work", () => {
    const definition = getBuiltInRoleDefinition("marketer");
    const notRun = observations("marketer");
    notRun[1] = { ...notRun[1]!, status: "not_run", evidence: [] };
    const incomplete = createRoleEvaluationResult({
      definition,
      artifactId,
      contentHash,
      byteCount: 32,
      mediaType,
      producerRunId: "run_marketer_0001",
      evaluatedAt: "2026-08-20T01:00:00.000Z",
      observations: notRun,
    });
    const failedObservations = observations("marketer");
    failedObservations[2] = { ...failedObservations[2]!, status: "failed" };
    const failed = createRoleEvaluationResult({
      definition,
      artifactId,
      contentHash,
      byteCount: 32,
      mediaType,
      producerRunId: "run_marketer_0001",
      evaluatedAt: "2026-08-20T01:00:00.000Z",
      observations: failedObservations,
    });

    expect(incomplete.overallStatus).toBe("incomplete");
    expect(failed.overallStatus).toBe("failed");
    expect(() => assertRoleArtifactPublishable({
      definition,
      result: incomplete,
      artifactId,
      contentHash,
    })).toThrow(/published/);
  });

  it("rejects missing evidence, missing checks and tampered result identity", () => {
    const definition = getBuiltInRoleDefinition("designer");
    const missingEvidence = observations("designer");
    missingEvidence[0] = { ...missingEvidence[0]!, evidence: [] };
    expect(() => createRoleEvaluationResult({
      definition,
      artifactId,
      contentHash,
      byteCount: 32,
      mediaType,
      producerRunId: "run_designer_0001",
      evaluatedAt: "2026-08-20T01:00:00.000Z",
      observations: missingEvidence,
    })).toThrow(/evidence/);
    const sameRun = observations("designer");
    sameRun[0] = { ...sameRun[0]!, evaluatorRunId: "run_designer_0001" };
    expect(() => createRoleEvaluationResult({
      definition,
      artifactId,
      contentHash,
      byteCount: 32,
      mediaType,
      producerRunId: "run_designer_0001",
      evaluatedAt: "2026-08-20T01:00:00.000Z",
      observations: sameRun,
    })).toThrow(/distinct from the producer run/);
    expect(() => createRoleEvaluationResult({
      definition,
      artifactId,
      contentHash,
      byteCount: 32,
      mediaType,
      producerRunId: "run_designer_0001",
      evaluatedAt: "2026-08-20T01:00:00.000Z",
      observations: observations("designer").slice(1),
    })).toThrow(/check/);

    const valid = createRoleEvaluationResult({
      definition,
      artifactId,
      contentHash,
      byteCount: 32,
      mediaType,
      producerRunId: "run_designer_0001",
      evaluatedAt: "2026-08-20T01:00:00.000Z",
      observations: observations("designer"),
    });
    const tampered: RoleEvaluationResult = { ...valid, overallStatus: "failed" };
    expect(() => assertRoleEvaluationResult({ definition, result: tampered })).toThrow(/ID|status/);
  });

  it("reads only the evaluated bytes from CAS for publication", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-role-evaluation-"));
    roots.push(root);
    const artifacts = await FileSystemCas.open(root);
    const content = "Research result with sources and limitations checked.";
    const stored = await artifacts.put(content);
    const definition = getBuiltInRoleDefinition("researcher");
    const result = createRoleEvaluationResult({
      definition,
      artifactId: "art_research_brief_01",
      contentHash: stored.contentHash,
      byteCount: stored.byteCount,
      mediaType,
      producerRunId: "run_researcher_0001",
      evaluatedAt: "2026-08-20T01:00:00.000Z",
      observations: observations("researcher"),
    });

    await expect(readPublishableRoleArtifact({ definition, result, artifactStore: artifacts }))
      .resolves.toBe(content);
    const corruptedStore = {
      put: artifacts.put.bind(artifacts),
      putStream: artifacts.putStream.bind(artifacts),
      has: artifacts.has.bind(artifacts),
      get: async () => new TextEncoder().encode(`${content} tampered`),
    };
    await expect(readPublishableRoleArtifact({
      definition,
      result,
      artifactStore: corruptedStore,
    })).rejects.toThrow(/size or hash/);
    await expect(readPublishableRoleArtifact({
      definition,
      result: { ...result, byteCount: result.byteCount + 1 },
      artifactStore: artifacts,
    })).rejects.toThrow(/ID|size/);
  });
});
