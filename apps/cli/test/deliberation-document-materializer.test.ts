import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { materializeDeliberationDocument } from "../src/deliberation-document-materializer.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<{ repositoryRoot: string; deliberationRoot: string }> {
  const repositoryRoot = await mkdtemp(resolve(tmpdir(), "lervo-materializer-"));
  roots.push(repositoryRoot);
  const deliberationRoot = resolve(repositoryRoot, ".lervo/state/deliberations/dlb_test0001");
  await mkdir(deliberationRoot, { recursive: true, mode: 0o700 });
  return { repositoryRoot, deliberationRoot };
}

describe("deliberation document materializer", () => {
  it("writes one immutable document directory and manifest inside the workspace", async () => {
    const paths = await workspace();
    const record = await materializeDeliberationDocument({
      ...paths,
      createdAt: "2026-08-22T00:00:00.000Z",
      documentId: "doc_materialized01",
      directoryName: "artifact-materialized01",
      filename: "content.md",
      content: "Verified content.\n",
      sourceId: "artifact:materialized01",
    });

    expect(record.path).toBe(
      ".lervo/state/deliberations/dlb_test0001/artifact-materialized01/content.md",
    );
    await expect(readFile(resolve(paths.repositoryRoot, record.path), "utf8")).resolves.toBe(
      "Verified content.\n",
    );
    if (record.ownership.mode !== "lervo_generated") {
      throw new Error("Generated document ownership differs.");
    }
    await expect(
      readFile(resolve(paths.repositoryRoot, record.ownership.manifestPath), "utf8"),
    ).resolves.toContain('"documentId": "doc_materialized01"');
  });

  it("rejects directory and filename traversal before creating temporary files", async () => {
    const paths = await workspace();
    const base = {
      ...paths,
      createdAt: "2026-08-22T00:00:00.000Z",
      documentId: "doc_materialized01",
      content: "Content\n",
      sourceId: "artifact:materialized01",
    };
    await expect(
      materializeDeliberationDocument({
        ...base,
        directoryName: "../escaped",
        filename: "content.md",
      }),
    ).rejects.toThrow("safe single path segment");
    await expect(
      materializeDeliberationDocument({
        ...base,
        directoryName: "artifact-materialized01",
        filename: "../escaped.md",
      }),
    ).rejects.toThrow("safe single path segment");
    await expect(
      readFile(resolve(paths.repositoryRoot, ".lervo/state/deliberations/escaped")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
