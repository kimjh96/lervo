import { access, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
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
  await writeFile(resolve(root, "docs/search-guide.md"), "# 검색 운영 안내\n\n검색 실패는 사람이 평가합니다.\n");
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
  it("reports zero observations without creating search state", async () => {
    const root = await repository();
    let output = "";
    expect(await runCli(["search", "report", "--json"], {
      cwd: root,
      stdout: (message) => { output += message; },
      stderr: () => undefined,
    })).toBe(0);
    expect(JSON.parse(output)).toMatchObject({ totalAttempts: 0, assessedAttempts: 0 });
    await expect(access(resolve(root, ".lervo/state/search"))).rejects.toThrow();
  });

  it("searches registered originals, records explicit feedback and reports failures without raw query", async () => {
    const root = await repository();
    let queryOutput = "";
    let queryError = "";
    const queryCode = await runCli(["search", "검색 실패", "--json"], {
      cwd: root,
      stdout: (message) => { queryOutput += message; },
      stderr: (message) => { queryError += message; },
    });
    expect(queryCode, queryError).toBe(0);
    const response = JSON.parse(queryOutput) as { attemptId: string; hits: Array<{ source: { sourceId: string } }> };
    expect(response.hits[0]?.source.sourceId).toBe("doc_search_guide_01");

    let assessmentOutput = "";
    expect(await runCli([
      "search", "assess", response.attemptId, "--outcome", "failed",
      "--reason", "insufficient_context", "--expected", "document:doc_missing_guide_01", "--json",
    ], {
      cwd: root,
      stdout: (message) => { assessmentOutput += message; },
      stderr: () => undefined,
    })).toBe(0);
    expect(JSON.parse(assessmentOutput)).toMatchObject({
      attemptId: response.attemptId,
      outcome: "failed",
      failureReason: "insufficient_context",
      expectedSources: [{ sourceKind: "document", sourceId: "doc_missing_guide_01" }],
    });
    let conflictError = "";
    expect(await runCli([
      "search", "assess", response.attemptId, "--outcome", "accepted",
      "--selected", "document:doc_search_guide_01",
    ], {
      cwd: root,
      stdout: () => undefined,
      stderr: (message) => { conflictError += message; },
    })).toBe(1);
    expect(conflictError).toContain("observation_conflict");

    let reportOutput = "";
    expect(await runCli(["search", "report", "--json"], {
      cwd: root,
      stdout: (message) => { reportOutput += message; },
      stderr: () => undefined,
    })).toBe(0);
    expect(JSON.parse(reportOutput)).toMatchObject({
      totalAttempts: 1,
      failedAttempts: 1,
      embeddingDecision: "not_determined",
    });

    const stored = await readFile(
      resolve(root, ".lervo/state/search/attempts", `${response.attemptId}.json`),
      "utf8",
    );
    expect(stored).not.toContain("검색 실패");
    expect(stored).not.toContain("docs/search-guide.md");
    expect((await stat(resolve(root, ".lervo/state/search/attempts", `${response.attemptId}.json`))).mode & 0o777)
      .toBe(0o600);
    expect((await stat(resolve(root, ".lervo/state/search/assessments", `${response.attemptId}.json`))).mode & 0o777)
      .toBe(0o600);
  });

  it("does not record an assessment inferred only from an empty result", async () => {
    const root = await repository();
    let queryError = "";
    const queryCode = await runCli(["search", "존재하지않는검색어"], {
      cwd: root,
      stdout: () => undefined,
      stderr: (message) => { queryError += message; },
    });
    expect(queryCode, queryError).toBe(0);

    const reportMessages: string[] = [];
    expect(await runCli(["search", "report", "--json"], {
      cwd: root,
      stdout: (message) => reportMessages.push(message),
      stderr: () => undefined,
    })).toBe(0);
    expect(JSON.parse(reportMessages.join(""))).toMatchObject({
      totalAttempts: 1,
      assessedAttempts: 0,
      unassessedAttempts: 1,
      evidenceState: "insufficient_assessment",
    });
  });

  it("rejects a symlinked document and a tampered observation instead of returning partial data", async () => {
    const root = await repository();
    await rm(resolve(root, "docs/search-guide.md"));
    await writeFile(resolve(root, "outside.md"), "# 검색 실패\n");
    await symlink(resolve(root, "outside.md"), resolve(root, "docs/search-guide.md"));
    let sourceError = "";
    expect(await runCli(["search", "검색 실패"], {
      cwd: root,
      stdout: () => undefined,
      stderr: (message) => { sourceError += message; },
    })).toBe(1);
    expect(sourceError).toContain("corpus_read_failed");

    await rm(resolve(root, "docs/search-guide.md"));
    await writeFile(resolve(root, "docs/search-guide.md"), "# 검색 실패\n");
    let queryOutput = "";
    expect(await runCli(["search", "검색 실패", "--json"], {
      cwd: root,
      stdout: (message) => { queryOutput += message; },
      stderr: () => undefined,
    })).toBe(0);
    const { attemptId } = JSON.parse(queryOutput) as { attemptId: string };
    const attemptPath = resolve(root, ".lervo/state/search/attempts", `${attemptId}.json`);
    const attempt = JSON.parse(await readFile(attemptPath, "utf8")) as { queryDigest: string };
    attempt.queryDigest = `sha256:${"0".repeat(64)}`;
    await writeFile(attemptPath, JSON.stringify(attempt));

    let reportError = "";
    expect(await runCli(["search", "report"], {
      cwd: root,
      stdout: () => undefined,
      stderr: (message) => { reportError += message; },
    })).toBe(1);
    expect(reportError).toContain("invalid_attempt");
  });
});
