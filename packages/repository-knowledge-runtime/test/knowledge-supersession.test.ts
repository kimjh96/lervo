import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { reconcileKnowledgeSupersession } from "../src/knowledge-supersession.js";
import {
  KNOWLEDGE_SUPERSESSION_LEDGER_PATH,
  mergeKnowledgeSupersessionEntries,
  readKnowledgeSupersessionLedger,
  type KnowledgeSupersessionEntry,
} from "../src/knowledge-supersession-ledger.js";
import { knowledgeCommitPatchIds } from "../src/knowledge-supersession-git.js";

const execute = promisify(execFile);
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((path) => rm(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })),
  );
});

const developer = { name: "Developer", email: "dev@example.com" };
const knowledge = { name: "Lervo Knowledge", email: "knowledge@lervo.invalid" };

async function git(root: string, args: string[], identity = developer) {
  const { stdout } = await execute("git", ["-C", root, ...args], {
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: identity.name,
      GIT_AUTHOR_EMAIL: identity.email,
      GIT_COMMITTER_NAME: identity.name,
      GIT_COMMITTER_EMAIL: identity.email,
    },
  });
  return stdout.trim();
}

async function commit(
  root: string,
  path: string,
  content: string,
  identity = developer,
  message = `write ${path}`,
) {
  await mkdir(resolve(root, path, ".."), { recursive: true });
  await writeFile(resolve(root, path), content);
  await git(root, ["add", "--", path], identity);
  await git(root, ["commit", "--quiet", "-m", message], identity);
  return git(root, ["rev-parse", "HEAD"]);
}

const reset = (root: string, target: string) => git(root, ["reset", "--hard", "--quiet", target]);

async function repository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-knowledge-supersession-"));
  directories.push(root);
  await git(root, ["init", "--quiet", "-b", "main"]);
  await writeFile(resolve(root, ".gitignore"), ".lervo/state/\n");
  await git(root, ["add", ".gitignore"]);
  const base = await commit(root, "docs/runtime.md", "# Runtime\n");
  return { root, base };
}

async function entries(
  root: string,
  commits: string[],
  base: string,
): Promise<KnowledgeSupersessionEntry[]> {
  const patchIds = await knowledgeCommitPatchIds(root, commits);
  return commits.map((commit) => ({
    commit,
    patchId: patchIds.get(commit)!,
    base,
    supersededAt: "2026-10-05T00:00:00.000Z",
  }));
}

const now = () => new Date("2026-10-06T00:00:00.000Z");

describe("knowledge supersession reconciliation", () => {
  it(
    "drops superseded knowledge commits at the tip, keeps developer work below, and repeats as a no-op",
    { timeout: 30_000 },
    async () => {
      const { root } = await repository();
      const work = await commit(root, "src/feature.ts", "export const value = 1;\n");
      const first = await commit(root, "docs/runtime.md", "# Runtime\n\nOne.\n", knowledge);
      const second = await commit(root, "docs/owner.md", "# Owner\n", knowledge);
      await writeFile(resolve(root, "notes.txt"), "uncommitted\n");
      const incoming = await entries(root, [first, second], work);
      const recorded = mergeKnowledgeSupersessionEntries([], incoming);

      const result = await reconcileKnowledgeSupersession({ repositoryRoot: root, incoming, now });
      expect(result).toMatchObject({
        dropped: {
          commitCount: 2,
          backupRef: `refs/lervo/knowledge-superseded/${second.slice(0, 12)}`,
        },
        held: null,
      });
      expect(await git(root, ["rev-parse", "HEAD"])).toBe(work);
      expect(await git(root, ["rev-parse", result.dropped!.backupRef])).toBe(second);
      expect(await readFile(resolve(root, "notes.txt"), "utf8")).toBe("uncommitted\n");
      const ledger = await readKnowledgeSupersessionLedger(root);
      expect(ledger).toMatchObject({
        entries: recorded,
        held: null,
        lastDrop: { commitCount: 2, droppedAt: "2026-10-06T00:00:00.000Z" },
      });
      const bytes = await readFile(resolve(root, KNOWLEDGE_SUPERSESSION_LEDGER_PATH), "utf8");

      const again = await reconcileKnowledgeSupersession({ repositoryRoot: root, incoming });
      expect(again).toEqual({ entries: recorded, dropped: null, held: null });
      expect(await readFile(resolve(root, KNOWLEDGE_SUPERSESSION_LEDGER_PATH), "utf8")).toBe(bytes);
    },
  );

  it(
    "drops a stale copy by patch but keeps a regeneration built on the conflicting base",
    { timeout: 30_000 },
    async () => {
      const { root, base } = await repository();
      const stale = await commit(root, "docs/owner.md", "# Owner\n", knowledge);
      // The remote base the stale commit's replay conflicted with.
      await reset(root, base);
      const remoteBase = await commit(root, "src/feature.ts", "export const value = 1;\n");
      const incoming = await entries(root, [stale], remoteBase);

      // The same patch under another commit id, still built on the stale base.
      await reset(root, base);
      const copy = await commit(root, "docs/owner.md", "# Owner\n", knowledge, "copy");
      expect(copy).not.toBe(stale);
      expect(
        await reconcileKnowledgeSupersession({ repositoryRoot: root, incoming, now }),
      ).toMatchObject({ dropped: { commitCount: 1 }, held: null });
      expect(await git(root, ["rev-parse", "HEAD"])).toBe(base);

      // The same patch regenerated on the remote base is current work and stays.
      await reset(root, remoteBase);
      const regenerated = await commit(root, "docs/owner.md", "# Owner\n", knowledge);
      expect((await knowledgeCommitPatchIds(root, [regenerated])).get(regenerated)).toBe(
        incoming[0]!.patchId,
      );
      expect(
        await reconcileKnowledgeSupersession({ repositoryRoot: root, incoming, now }),
      ).toMatchObject({ dropped: null, held: null });
      expect(await git(root, ["rev-parse", "HEAD"])).toBe(regenerated);
    },
  );

  it(
    "holds superseded commits under developer work, in a detached head, and under conflicting edits",
    { timeout: 30_000 },
    async () => {
      const { root, base } = await repository();
      const stale = await commit(root, "docs/owner.md", "# Owner\n", knowledge);
      const incoming = await entries(root, [stale], base);
      const work = await commit(root, "src/feature.ts", "export const value = 1;\n");
      expect(
        await reconcileKnowledgeSupersession({ repositoryRoot: root, incoming, now }),
      ).toMatchObject({
        dropped: null,
        held: { reason: "under_other_work", commits: [stale] },
      });
      expect(await git(root, ["rev-parse", "HEAD"])).toBe(work);
      expect((await readKnowledgeSupersessionLedger(root)).held).toEqual({
        reason: "under_other_work",
        commitCount: 1,
        observedAt: "2026-10-06T00:00:00.000Z",
      });

      await git(root, ["reset", "--hard", "--quiet", stale]);
      await git(root, ["checkout", "--quiet", "--detach"]);
      expect(await reconcileKnowledgeSupersession({ repositoryRoot: root, now })).toMatchObject({
        held: { reason: "not_on_branch", commits: [stale] },
      });

      await git(root, ["checkout", "--quiet", "main"]);
      await writeFile(resolve(root, "docs/owner.md"), "# Owner\n\nEdited.\n");
      expect(await reconcileKnowledgeSupersession({ repositoryRoot: root, now })).toMatchObject({
        held: { reason: "worktree_conflict", commits: [stale] },
      });
      expect(await git(root, ["rev-parse", "HEAD"])).toBe(stale);

      await git(root, ["checkout", "--quiet", "--", "docs/owner.md"]);
      expect(await reconcileKnowledgeSupersession({ repositoryRoot: root, now })).toMatchObject({
        dropped: { commitCount: 1 },
        held: null,
      });
      expect((await readKnowledgeSupersessionLedger(root)).held).toBeNull();
    },
  );

  it("merges entries from two hosts deterministically and keeps the newest 64", () => {
    const entry = (index: number): KnowledgeSupersessionEntry => ({
      commit: index.toString(16).padStart(40, "0"),
      patchId: "a".repeat(40),
      base: "b".repeat(40),
      supersededAt: new Date(Date.UTC(2026, 9, 1, 0, index)).toISOString(),
    });
    const left = Array.from({ length: 40 }, (_, index) => entry(index));
    const right = Array.from({ length: 40 }, (_, index) => entry(index + 30));
    const merged = mergeKnowledgeSupersessionEntries(left, right);
    expect(merged).toEqual(mergeKnowledgeSupersessionEntries(right, left));
    expect(merged).toHaveLength(64);
    expect(merged[0]).toEqual(entry(6));
    expect(merged.at(-1)).toEqual(entry(69));
  });
});
