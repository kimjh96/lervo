import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defaultRepositoryKnowledgePolicy, scanRepositoryKnowledge } from "../src/index.js";
import { secretCandidatePath } from "../src/repository-source-classification.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("secret candidate paths", () => {
  it("treats every environment file except explicit templates as a secret candidate", () => {
    for (const path of [".env", ".env.local", "apps/web/.env.local", "x/.env.development.local"])
      expect(secretCandidatePath(path), path).toBe(true);
    for (const path of [".env.example", "etl/.env.example", ".env.sample", ".env.template"])
      expect(secretCandidatePath(path), path).toBe(false);
  });

  it("never reads the bytes of an environment file, even outside Git", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-secret-candidate-"));
    roots.push(root);
    await mkdir(resolve(root, "apps/web"), { recursive: true });
    await writeFile(resolve(root, "apps/web/.env.local"), "API_KEY=do-not-read-this-value\n");
    await writeFile(resolve(root, "apps/web/.env.example"), "API_KEY=\n");
    const scan = await scanRepositoryKnowledge({
      repositoryRoot: root,
      projectId: "prj_secretfixture",
      policy: defaultRepositoryKnowledgePolicy,
      observeRevision: async () => ({ status: "unavailable", reason: "git_head_unavailable" }),
    });
    const local = scan.sources.find((source) => source.path === "apps/web/.env.local");
    expect(local).toMatchObject({
      classification: "secret_candidate",
      contentHash: null,
      reason: "secret_candidate_bytes_not_read",
    });
    expect(JSON.stringify(scan)).not.toContain("do-not-read-this-value");
    expect(scan.sources.find((source) => source.path === "apps/web/.env.example")).toMatchObject({
      status: "included",
    });
  });
});
