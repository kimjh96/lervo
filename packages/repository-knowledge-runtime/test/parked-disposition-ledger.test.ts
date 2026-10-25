import { expect, it } from "vitest";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import type { ArtifactStore, OutboxStore } from "@lervo/storage-contract";
import {
  integratedCanonicalDrafts,
  settledCanonicalDispositions,
} from "../src/canonical-disposition-ledger.js";

it.each(["target_diverged", "layout_capacity_exceeded"])(
  "retains other coverage without settling %s candidates or drafts",
  async (reason) => {
    const sources = ["candidate.ts", "covered.ts"].map((path) => ({
      path,
      contentHash: sha256(path),
      kind: "text",
    }));
    const assessment = {
      decisions: sources.map((source, index) => ({
        ...source,
        disposition: index === 0 ? "candidate" : "no_change",
        canonicalReferences: [],
      })),
      drafts: [{ path: "docs/new.md", beforeHash: null, content: "# Unapplied\n" }],
    };
    const assessmentHash = sha256(canonicalJson(assessment));
    const before = {
      obligationId: "obligation",
      baseline: { projectId: "project", policyHash: "policy" },
      stageData: {
        canonicalBatch: { sources, assessment, generatorAgentId: "generator" },
        canonicalApproval: {
          decision: "approve",
          assessmentHash,
          sourceHashes: sources.map((source) => source.contentHash),
          draftHashes: [sha256(assessment.drafts[0]!.content)],
          reviewerAgentId: "reviewer",
          policyHash: "policy",
        },
      },
    };
    const after = {
      stageData: {
        canonicalTargetParked: assessmentHash,
        parkedSources: [{ path: "candidate.ts", reason }],
      },
    };
    const bodies = [before, after].map((value) => Buffer.from(canonicalJson(value)));
    const hashes = bodies.map(sha256);
    const artifacts = {
      get: async (uri: string) =>
        bodies[hashes.findIndex((hash) => uri === `lervo-cas://sha256/${hash.slice(7)}`)]!,
    } as unknown as ArtifactStore;
    const events = {
      list: ({ afterSeq }: { afterSeq: number }) =>
        afterSeq > 0
          ? []
          : [
              {
                seq: 1,
                eventId: "event",
                projectId: "project",
                type: "repository.knowledge.stage.recorded",
                payload: {
                  stage: "canonical_integration",
                  state: "current",
                  obligationId: "obligation",
                  inputArtifactHash: hashes[0],
                  resultArtifactHash: hashes[1],
                },
              },
            ],
    } as unknown as OutboxStore;
    expect(
      await settledCanonicalDispositions({
        repositoryRoot: ".",
        events,
        artifacts,
        projectId: "project",
        policyHash: "policy",
        sources: [
          ...sources,
          { path: "docs/new.md", contentHash: sha256(assessment.drafts[0]!.content) },
        ],
      }),
    ).toEqual([
      {
        path: "covered.ts",
        contentHash: sha256("covered.ts"),
        disposition: "no_change",
        eventId: "event",
      },
    ]);
    expect(await integratedCanonicalDrafts(events, artifacts)).toEqual(new Map());
  },
);
