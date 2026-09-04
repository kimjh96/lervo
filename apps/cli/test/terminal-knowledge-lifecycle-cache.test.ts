import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { RepositorySupplementalSource } from "@lervo/repository-knowledge";
import { afterEach, describe, expect, it } from "vitest";

import {
  readTerminalKnowledgeLifecycleCache,
  writeTerminalKnowledgeLifecycleCache,
} from "../src/terminal-knowledge-lifecycle-cache.js";

const roots: string[] = [];
const revision = `sha256:${"a".repeat(64)}`;

function source(content: string): RepositorySupplementalSource {
  return {
    path: ".lervo/events/verification-result.md",
    kind: "verification_result",
    classification: "ordinary",
    content,
    origin: "verification_event_cas",
    unitKind: "verification",
    locator: "verification:result",
    title: "Verification result",
    adapter: "test",
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("terminal knowledge lifecycle cache", () => {
  it("reuses only exact repository and supplemental-source coordinates", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-terminal-knowledge-cache-"));
    roots.push(root);
    const supplementalSources = [source("passed")];
    const issues = [{ code: "document_normalization_pending", command: "lervo migrate knowledge" }];
    await writeTerminalKnowledgeLifecycleCache({
      root,
      repositoryRevision: revision,
      supplementalSources,
      issues,
    });

    await expect(
      readTerminalKnowledgeLifecycleCache({
        root,
        repositoryRevision: revision,
        supplementalSources,
      }),
    ).resolves.toEqual(issues);
    await expect(
      readTerminalKnowledgeLifecycleCache({
        root,
        repositoryRevision: `sha256:${"b".repeat(64)}`,
        supplementalSources,
      }),
    ).resolves.toBeNull();
    await expect(
      readTerminalKnowledgeLifecycleCache({
        root,
        repositoryRevision: revision,
        supplementalSources: [source("failed")],
      }),
    ).resolves.toBeNull();

    const stored = await readFile(
      resolve(root, ".lervo/state/terminal-integration/knowledge-lifecycle-cache.json"),
      "utf8",
    );
    expect(stored).not.toContain("passed");
    expect(stored).not.toContain("failed");
  });

  it("invalidates when the current knowledge projection changes", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-terminal-knowledge-cache-"));
    roots.push(root);
    const current = resolve(root, ".lervo/state/knowledge/current");
    const manifestDirectory = resolve(current, "structural/manifests");
    await mkdir(manifestDirectory, { recursive: true });
    await writeFile(resolve(current, "source-units.json"), '{"snapshotId":"one"}\n');
    await writeFile(resolve(manifestDirectory, "current.json"), '{"generation":1}\n');
    const supplementalSources = [source("passed")];
    const issues = [{ code: "repository_knowledge_ready", command: "lervo migrate knowledge" }];
    await writeTerminalKnowledgeLifecycleCache({
      root,
      repositoryRevision: revision,
      supplementalSources,
      issues,
    });

    await expect(
      readTerminalKnowledgeLifecycleCache({
        root,
        repositoryRevision: revision,
        supplementalSources,
      }),
    ).resolves.toEqual(issues);

    await writeFile(resolve(current, "source-units.json"), '{"snapshotId":"two"}\n');
    await expect(
      readTerminalKnowledgeLifecycleCache({
        root,
        repositoryRevision: revision,
        supplementalSources,
      }),
    ).resolves.toBeNull();

    const stored = await readFile(
      resolve(root, ".lervo/state/terminal-integration/knowledge-lifecycle-cache.json"),
      "utf8",
    );
    expect(stored).not.toContain("snapshotId");
  });
});
