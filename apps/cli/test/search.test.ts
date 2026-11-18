import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { serializeYaml } from "@lervo/project";
import type { DocumentManifest } from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const roots: string[] = [];

function manifest(): DocumentManifest {
  return {
    schemaVersion: 1,
    documentId: "doc_search_guide_01",
    record: {
      path: "docs/search-guide.md",
      kind: "canonical",
      responsibleParty: { kind: "team", id: "platform" },
      connectedPaths: ["packages/search"],
      verifiedRevision: "fixture-v1",
      verifiedAt: "2026-08-20T00:00:00.000Z",
      reviewIntervalDays: 30,
      ownership: { mode: "user" },
    },
    contentPolicy: {
      mode: "user_managed",
      mediaType: "text/markdown; charset=utf-8",
      profileId: "search/guide",
      locale: "ko-KR",
      audience: "human",
      metadataPlacement: "sidecar",
      historyMode: "separate_documents",
      splitStrategy: "topic_documents",
      automaticWrites: false,
      splitRecommendedAtBytes: 32768,
      oversizeReviewAtBytes: 65536,
      overflowAction: "report_split_recommended",
    },
    relations: { supersedesDocumentIds: [], relatedDocumentIds: [] },
  };
}

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-search-cli-"));
  roots.push(root);
  const silent = { cwd: root, stdout: () => undefined, stderr: () => undefined };
  expect(await runCli(["init"], silent)).toBe(0);
  await mkdir(resolve(root, "docs"));
  await mkdir(resolve(root, ".lervo/documents"));
  await writeFile(
    resolve(root, "docs/search-guide.md"),
    "# Search operations guide\n\nPeople evaluate search failures.\n",
  );
  await writeFile(
    resolve(root, ".lervo/documents/doc_search_guide_01.yaml"),
    serializeYaml(manifest()),
  );
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("lervo search vertical slice", () => {
  it("searches registered originals and records the attempt without the raw query", async () => {
    const root = await repository();
    let queryOutput = "";
    let queryError = "";
    const queryCode = await runCli(["search", "search failures", "--json"], {
      cwd: root,
      stdout: (message) => {
        queryOutput += message;
      },
      stderr: (message) => {
        queryError += message;
      },
    });
    expect(queryCode, queryError).toBe(0);
    const response = JSON.parse(queryOutput) as {
      attemptId: string;
      hits: Array<{ source: { sourceId: string } }>;
    };
    expect(response.hits[0]?.source.sourceId).toBe("doc_search_guide_01");

    const stored = await readFile(
      resolve(root, ".lervo/state/search/attempts", `${response.attemptId}.json`),
      "utf8",
    );
    expect(stored).not.toContain("search failures");
    expect(stored).not.toContain("docs/search-guide.md");
    expect(
      (await stat(resolve(root, ".lervo/state/search/attempts", `${response.attemptId}.json`)))
        .mode & 0o777,
    ).toBe(0o600);
  });

  it("rejects a symlinked document instead of returning partial data", async () => {
    const root = await repository();
    await rm(resolve(root, "docs/search-guide.md"));
    await writeFile(resolve(root, "outside.md"), "# Search failures\n");
    await symlink(resolve(root, "outside.md"), resolve(root, "docs/search-guide.md"));
    let sourceError = "";
    expect(
      await runCli(["search", "search failures"], {
        cwd: root,
        stdout: () => undefined,
        stderr: (message) => {
          sourceError += message;
        },
      }),
    ).toBe(1);
    expect(sourceError).toContain("corpus_read_failed");
  });
});
