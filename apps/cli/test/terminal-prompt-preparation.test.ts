import type { RepositorySnapshot } from "@lervo/orchestrator";
import { scanConfiguredRepositoryKnowledge } from "@lervo/repository-knowledge";
import type { SearchQueryProjection } from "@lervo/search";
import { describe, expect, it } from "vitest";

import { coordinateTerminalPromptPreparation } from "../src/terminal-prompt-preparation.js";

const repositorySnapshot = {
  revision: "sha256:repository",
  files: [],
} as unknown as RepositorySnapshot;

const preparedKnowledge = {
  manifest: { projectId: "prj_concurrent" },
  policy: { publication: { language: "en" } },
} as unknown as Awaited<ReturnType<typeof scanConfiguredRepositoryKnowledge>>;

describe("terminal prompt preparation", () => {
  it("starts corpus, query, and snapshot work before awaiting any branch", async () => {
    const started: string[] = [];
    let releaseCorpus!: () => void;
    const corpusGate = new Promise<void>((resolve) => {
      releaseCorpus = resolve;
    });
    const preparation = coordinateTerminalPromptPreparation({
      requestDigest: "sha256:request",
      prepareCorpus: async () => {
        started.push("corpus");
        await corpusGate;
        return {
          supplementalSources: [],
          instructionCatalog: {
            complete: true,
            sourceSnapshotId: "sha256:snapshot",
            semanticCatalog: {
              schemaVersion: 1,
              retrievalLanguage: "en",
              canonicalInstructions: { complete: true, entries: [] },
            },
          },
          canonicalization: { coverage: "complete", candidates: [] },
          preparedKnowledge,
        };
      },
      prepareQuery: async () => {
        started.push("query");
        return {
          queryProjection: {} as SearchQueryProjection,
          currentWorkstream: null,
          projectId: "prj_concurrent",
          requestedLanguage: "en",
        };
      },
      captureSnapshot: async () => {
        started.push("snapshot");
        return repositorySnapshot;
      },
    });

    await Promise.resolve();
    expect(started).toEqual(["corpus", "query", "snapshot"]);
    releaseCorpus();
    await expect(preparation).resolves.toMatchObject({ requestDigest: "sha256:request" });
  });

  it("rejects mismatched project or language coordinates", async () => {
    const prepareCorpus = async () => ({
      supplementalSources: [],
      instructionCatalog: {
        complete: true,
        sourceSnapshotId: "sha256:snapshot",
        semanticCatalog: {
          schemaVersion: 1 as const,
          retrievalLanguage: "en",
          canonicalInstructions: { complete: true, entries: [] },
        },
      },
      canonicalization: { coverage: "complete" as const, candidates: [] },
      preparedKnowledge,
    });
    const prepareQuery = async () => ({
      queryProjection: {} as SearchQueryProjection,
      currentWorkstream: null,
      projectId: "prj_other",
      requestedLanguage: "en",
    });

    await expect(
      coordinateTerminalPromptPreparation({
        requestDigest: "sha256:request",
        prepareCorpus,
        prepareQuery,
        captureSnapshot: async () => repositorySnapshot,
      }),
    ).rejects.toThrow("changed during concurrent inspection");
  });
});
