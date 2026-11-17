import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { SkillManifest } from "@lervo/schemas";
import { hashSkillPackage } from "@lervo/skills";
import { afterEach, describe, expect, it } from "vitest";

import {
  defaultRepositoryKnowledgePolicy,
  observeProcessCost,
  scanRepositoryKnowledge,
  withRepositoryKnowledgeScanReuse,
  type RepositoryKnowledgeScan,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function git(root: string, ...args: string[]): void {
  execFileSync("git", args, { cwd: root, stdio: "ignore" });
}

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-scan-reuse-"));
  roots.push(root);
  git(root, "init", "-q");
  await mkdir(resolve(root, "docs"));
  await writeFile(resolve(root, "README.md"), "# Repository\n");
  await writeFile(resolve(root, "docs/guide.md"), "# Guide\n\nFirst version.\n");
  await writeFile(resolve(root, "main.ts"), "export const value = 1;\n");
  await writeFile(resolve(root, "debug.txt"), "local notes\n");
  git(root, "add", "README.md", "docs/guide.md", "main.ts");
  git(root, "-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-qm", "init");
  return root;
}

/** Moves every file's timestamps out of the racy window, as for a repository at rest. */
async function settle(root: string, ...paths: string[]): Promise<void> {
  const past = new Date(Date.now() - 60_000);
  for (const path of paths) await utimes(resolve(root, path), past, past);
}

const scan = (root: string, supplemental = false) =>
  scanRepositoryKnowledge({
    repositoryRoot: root,
    projectId: "prj_scanreusefixture",
    policy: defaultRepositoryKnowledgePolicy,
    ...(supplemental
      ? {
          supplementalSources: [
            {
              path: "@event/evt_fixture",
              kind: "execution_event" as const,
              classification: "ordinary" as const,
              content: "event",
              origin: "execution_event_store" as const,
              unitKind: "event" as const,
              locator: "evt_fixture",
              title: "Fixture event",
              adapter: "lervo.event-store",
            },
          ],
        }
      : {}),
  });

/** Fresh scans started while `run` runs, counted by the scanner's own cost scope. */
async function freshScans<T>(run: () => Promise<T>): Promise<{ value: T; scans: number }> {
  const observer = observeProcessCost();
  try {
    const value = await run();
    return { value, scans: observer.snapshot().scopes.scan?.calls ?? 0 };
  } finally {
    observer.close();
  }
}

const content = (result: RepositoryKnowledgeScan, path: string) =>
  result.sources.find((source) => source.path === path)?.contentHash;

describe("repository scan reuse (ADR-0582)", () => {
  it("reuses one scan of unchanged inputs inside a scope and never outside it", async () => {
    const root = await repository();
    await settle(root, "README.md", "docs/guide.md", "main.ts", "debug.txt");
    const inside = await freshScans(() =>
      withRepositoryKnowledgeScanReuse(async () => [await scan(root), await scan(root)]),
    );
    expect(inside.scans).toBe(1);
    expect(inside.value[1]).toBe(inside.value[0]);

    const outside = await freshScans(async () => [await scan(root), await scan(root)]);
    expect(outside.scans).toBe(2);
    expect(outside.value[1]).not.toBe(outside.value[0]);
  });

  it("keys reuse on the exact inputs, such as supplemental evidence", async () => {
    const root = await repository();
    const result = await freshScans(() =>
      withRepositoryKnowledgeScanReuse(async () => {
        await scan(root);
        await scan(root, true);
        await scan(root);
        await scan(root, true);
      }),
    );
    expect(result.scans).toBe(2);
  });

  it("scans again after an edit that keeps size and modification time", async () => {
    const root = await repository();
    await settle(root, "README.md", "docs/guide.md", "main.ts", "debug.txt");
    const before = await stat(resolve(root, "docs/guide.md"));
    const result = await freshScans(() =>
      withRepositoryKnowledgeScanReuse(async () => {
        const first = await scan(root);
        await writeFile(resolve(root, "docs/guide.md"), "# Guide\n\nOther version.\n");
        await utimes(resolve(root, "docs/guide.md"), before.atime, before.mtime);
        return [first, await scan(root)] as const;
      }),
    );
    expect(result.scans).toBe(2);
    expect(content(result.value[1], "docs/guide.md")).not.toBe(
      content(result.value[0], "docs/guide.md"),
    );
  });

  it("verifies a file changed within the racy window by its bytes", async () => {
    const root = await repository();
    // No settle: every file was just written, so a same-tick rewrite could keep its stat.
    const result = await freshScans(() =>
      withRepositoryKnowledgeScanReuse(async () => {
        const first = await scan(root);
        const unchanged = await scan(root);
        await writeFile(resolve(root, "main.ts"), "export const value = 2;\n");
        return [first, unchanged, await scan(root)] as const;
      }),
    );
    expect(result.value[1]).toBe(result.value[0]);
    expect(result.scans).toBe(2);
    expect(content(result.value[2], "main.ts")).not.toBe(content(result.value[0], "main.ts"));
  });

  it("scans again after a file is added or a Git ignore rule changes", async () => {
    const root = await repository();
    await settle(root, "README.md", "docs/guide.md", "main.ts", "debug.txt");
    const result = await freshScans(() =>
      withRepositoryKnowledgeScanReuse(async () => {
        const first = await scan(root);
        await writeFile(resolve(root, "docs/added.md"), "# Added\n");
        const added = await scan(root);
        await writeFile(resolve(root, ".git/info/exclude"), "debug.txt\n");
        return [first, added, await scan(root)] as const;
      }),
    );
    expect(result.scans).toBe(3);
    const paths = result.value.map((item) => item.sources.map((source) => source.path));
    expect(paths[0]).not.toContain("docs/added.md");
    expect(paths[1]).toContain("docs/added.md");
    expect(paths[1]).toContain("debug.txt");
    expect(paths[2]).not.toContain("debug.txt");
  });

  it("scans again after a commit moves the revision", async () => {
    const root = await repository();
    await settle(root, "README.md", "docs/guide.md", "main.ts", "debug.txt");
    const result = await freshScans(() =>
      withRepositoryKnowledgeScanReuse(async () => {
        const first = await scan(root);
        git(root, "commit", "-qm", "e", "--allow-empty", "--author", "t <t@example.com>");
        return [first, await scan(root)] as const;
      }),
    );
    expect(result.scans).toBe(2);
    expect(content(result.value[1], "@git/HEAD")).not.toBe(
      content(result.value[0], "@git/HEAD"),
    );
  });

  it("hashes project skill packages again, including files the walk skips", async () => {
    const root = await repository();
    await writeFile(resolve(root, ".gitignore"), "*.local\n");
    const directory = resolve(root, ".agents/skills/repository-testing");
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, "SKILL.md"), "# Repository testing\n\nRun the checks.\n");
    await writeFile(resolve(directory, "notes.local"), "first\n");
    const manifest: SkillManifest = {
      schemaVersion: 1,
      skillId: "repository/testing",
      version: "1.2.3",
      contentHash: await hashSkillPackage(directory),
      source: {
        kind: "project",
        uri: ".agents/skills/repository-testing",
        publisher: { id: "fixture", name: "Fixture" },
      },
      supportedRoles: ["developer"],
      compatibility: {
        providers: { mode: "any" },
        minimumRuntimeVersion: "0.1.0",
        platforms: [process.platform as "darwin" | "linux" | "win32"],
        requiredTools: [],
        unknownIsCompatible: false,
      },
      requiredCapabilities: ["filesystem.read"],
      contracts: {
        inputSchemaRef: "lervo-schema://skill/input/v1",
        outputSchemaRef: "lervo-schema://skill/output/v1",
      },
      trust: { level: "untrusted", signatureStatus: "unsigned" },
      enabledScope: { kind: "user" },
      pinned: false,
    };
    await writeFile(resolve(directory, "lervo-skill.json"), `${JSON.stringify(manifest)}\n`);
    await withRepositoryKnowledgeScanReuse(async () => {
      const first = await scan(root);
      expect(first.units.some((unit) => unit.unitKind === "skill_contract")).toBe(true);
      expect(first.sources.map((source) => source.path)).not.toContain(
        ".agents/skills/repository-testing/notes.local",
      );
      // The Git-ignored file is never walked, but it is part of the package the manifest binds.
      await writeFile(resolve(directory, "notes.local"), "second\n");
      await expect(scan(root)).rejects.toMatchObject({ code: "knowledge_unit_extraction_failed" });
    });
  });
});
