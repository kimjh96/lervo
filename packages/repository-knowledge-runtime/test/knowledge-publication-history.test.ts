import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import type { KnowledgeOutputFormatter } from "../src/knowledge-output-formatter.js";
import {
  KnowledgePublicationForgeError,
  type KnowledgePublicationHistoryEntry,
} from "../src/knowledge-publication-forge.js";
import { closureCause } from "../src/knowledge-publication-github.js";
import {
  deriveKnowledgePublicationHistory,
  KNOWLEDGE_PUBLICATION_HISTORY_PATH,
  markKnowledgePublicationClosed,
  parseKnowledgePublicationRecord,
  readKnowledgePublicationHistoryCache,
  renderKnowledgePublicationRecord,
  writeKnowledgePublicationHistoryCache,
} from "../src/knowledge-publication-history.js";
import { localPatches, pullRequestPatchIds } from "../src/knowledge-publication-pull-patches.js";
import {
  KNOWLEDGE_PUBLICATION_STATE_PATH,
  readKnowledgePublicationState,
} from "../src/knowledge-publication-state.js";
import {
  acknowledgeKnowledgePublicationAttention,
  readKnowledgePublicationAcknowledged,
} from "../src/knowledge-publication-tracking.js";
import { readKnowledgeSupersessionLedger } from "../src/knowledge-supersession-ledger.js";
import {
  advanceRemoteMain,
  commit,
  developer,
  directories,
  execute,
  git,
  isAncestor,
  knowledge,
  setup,
} from "./knowledge-publication-fixture.js";

/**
 * ADR-0603: GitHub is the source of truth for what is published; the local record is a cache. And
 * ADR-0602: GitHub-side waits back off, then arm no timer.
 */

const sha = (digit: string | number) => String(digit).repeat(40).slice(0, 40);
const entry = (
  number: number,
  record: { head: string; commits: string[] } | null,
  options: Partial<KnowledgePublicationHistoryEntry> = {},
): KnowledgePublicationHistoryEntry => ({
  number,
  merged: true,
  headSha: record?.head ?? sha("f"),
  mergeCommit: sha("e"),
  mergedAt: "2026-11-21T00:10:00.000Z",
  updatedAt: "2026-11-21T00:10:00.000Z",
  record: record === null ? "" : `## Summary\n\n${renderKnowledgePublicationRecord(record)}\n`,
  ...options,
});

describe("the publication record and its derivation", () => {
  it("counts a local commit published only by a patch a merged pull request carried, uncapped", () => {
    const local = new Map(
      Array.from(
        { length: 70 },
        (_, index) => [sha(index % 10) + index, { patch: `p${index}` }] as const,
      ),
    );
    const merged = [...local.values()].map((_item, index) =>
      entry(index + 1, null, { mergeCommit: index === 69 ? null : sha("e") }),
    );
    const carried = new Map([...local.values()].map((item, index) => [index + 1, [item.patch]]));
    // A record that claims a commit its pull request never carried counts for nothing.
    const forged = entry(71, { head: sha("1"), commits: [sha("9")] });
    const history = deriveKnowledgePublicationHistory({
      entries: [...merged, forged],
      carried: new Map([...carried, [71, ["unrelated"]]]),
      local: new Map([...local, [sha("9"), { patch: "p-forged" }]]),
      after: new Set(),
      closures: new Map(),
    });
    expect(history.published.size).toBe(70);
    expect(history.published.has(sha("9"))).toBe(false);
    // GitHub reports MERGED before it reports the merge commit: its patches still count.
    expect(history.lastMerged).toEqual({ pullRequestNumber: 71, mergeCommit: sha("e") });
  });

  it("reads a person's closure as declined, and Lervo's or a deleted branch's as nothing", () => {
    const record = { head: sha("1"), commits: [sha("a"), sha("b")] };
    const unmerged = { merged: false, mergeCommit: null };
    const lervo = entry(2, null, {
      ...unmerged,
      record: markKnowledgePublicationClosed(renderKnowledgePublicationRecord(record), "rerun"),
    });
    const person = entry(3, record, unmerged);
    const deleted = entry(5, record, unmerged);
    // A commit a later merged pull request carried is no longer held back.
    const later = entry(4, null);
    const local = new Map([
      [sha("a"), { patch: "pa" }],
      [sha("b"), { patch: "pb" }],
    ]);
    const carried = new Map([
      [2, ["pa", "pb"]],
      [3, ["pa", "pb"]],
      [4, ["pb"]],
      [5, ["pa", "pb"]],
    ]);
    const history = deriveKnowledgePublicationHistory({
      entries: [lervo, person, later, deleted],
      carried,
      local,
      after: new Set(),
      closures: new Map([
        [2, "person"],
        [3, "person"],
        [5, "branch_deleted"],
      ]),
    });
    expect(history.declined).toEqual([{ pullRequestNumber: 3, commits: [sha("a")] }]);
    expect(parseKnowledgePublicationRecord(lervo.record)).toMatchObject({ closed: "rerun" });
    // A malformed or missing record is no record.
    expect(
      parseKnowledgePublicationRecord(
        "<!-- lervo-publication-record\nLervo-Publication-Head: x\n-->",
      ),
    ).toBeNull();
    expect(parseKnowledgePublicationRecord("no record")).toBeNull();
  });

  it("reads GitHub's close next to a branch deletion as no decision", () => {
    const at = (seconds: number) => new Date(Date.UTC(2026, 10, 21, 0, 0, seconds)).toISOString();
    expect(
      closureCause([
        { event: "head_ref_deleted", created_at: at(0) },
        { event: "closed", created_at: at(1) },
      ]),
    ).toBe("branch_deleted");
    // A person closed it, and only later deleted the branch.
    expect(
      closureCause([
        { event: "closed", created_at: at(0) },
        { event: "head_ref_deleted", created_at: new Date(Date.UTC(2026, 10, 22)).toISOString() },
      ]),
    ).toBe("person");
    expect(closureCause([{ event: "closed", created_at: at(5) }])).toBe("person");
    // A person closed it, then deleted the branch seconds later: their decision came first.
    expect(
      closureCause([
        { event: "closed", created_at: at(10) },
        { event: "head_ref_deleted", created_at: at(13) },
      ]),
    ).toBe("person");
  });

  it("ignores a cache from another host or an invalid one", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-publication-history-"));
    directories.push(root);
    const cache = {
      schemaVersion: 2 as const,
      repository: "example/repository",
      history: { through: null, pullRequests: [], pullPatches: { [`7:${sha("5")}`]: [sha("4")] } },
      local: {
        hostHash: "sha256:a",
        base: sha("1"),
        head: sha("2"),
        published: [sha("3")],
        declined: [],
        lastMerged: null,
      },
    };
    await writeKnowledgePublicationHistoryCache(root, cache);
    await expect(readKnowledgePublicationHistoryCache(root)).resolves.toEqual(cache);
    await writeKnowledgePublicationHistoryCache(root, {
      ...cache,
      local: { ...cache.local, published: ["nope"] },
    });
    await expect(readKnowledgePublicationHistoryCache(root)).resolves.toBeNull();
  });
});

const branchUpdates = async (remote: string) =>
  (await git(remote, ["reflog", "show", "--format=%H", "refs/heads/lervo/knowledge-outputs"]))
    .split("\n")
    .filter((line) => line !== "").length;

/** Removes every local publication record, as a fresh host or lost state has none. */
async function forgetLocalState(root: string) {
  for (const path of [KNOWLEDGE_PUBLICATION_STATE_PATH, KNOWLEDGE_PUBLICATION_HISTORY_PATH])
    await rm(resolve(root, path), { force: true });
}

describe("published is what GitHub's merged pull requests carried (ADR-0603)", () => {
  it(
    "derives the same answer on a host with empty state after a squash and a later base edit",
    { timeout: 60_000 },
    async () => {
      const { root, remote, forge, publish } = await setup({ merge: "never" });
      await commit(root, "docs/runtime.md", "# Runtime\n\nFirst.\n", knowledge);
      await commit(root, "docs/runtime.md", "# Runtime\n\nSecond.\n", knowledge);
      await commit(root, "src/app.ts", "export {};\n", developer, "feat: local work");
      await publish();
      // A person squash-merges it, then edits the document, so its bytes no longer tell.
      const opened = forge.pullRequests[0]!;
      await forge.merge({ number: opened.number, headSha: opened.headSha, method: "squash" });
      await advanceRemoteMain(remote, "docs/runtime.md", "# Runtime\n\nA person's edit.\n");
      // The publishing host switched, or its state was lost: nothing local says what merged.
      await forgetLocalState(root);
      const after = await publish();
      expect(after).not.toMatchObject({ state: { status: "superseded" } });
      expect(forge.pullRequests).toHaveLength(1);
      expect((await readKnowledgeSupersessionLedger(root))?.entries ?? []).toEqual([]);
      // The person's edit of the merged document is the owner's change, and reported.
      expect(await readKnowledgePublicationState(root)).toMatchObject({
        baseChanged: { pullRequestNumber: 1, paths: 1 },
      });
    },
  );

  it(
    "never counts a commit a forged record claims, so the catch-up cannot drop it",
    { timeout: 60_000 },
    async () => {
      const { root, forge, publish } = await setup({ merge: "never" });
      await commit(root, "docs/a.md", "# A\n", knowledge);
      await publish();
      await commit(root, "docs/b.md", "# B\n", knowledge);
      const unpublished = await git(root, ["rev-parse", "HEAD"]);
      // Someone edits the open pull request's record to claim the later commit, then merges it.
      const opened = forge.pullRequests[0]!;
      opened.body = opened.body.replace("-->", `Lervo-Publication-Commit: ${unpublished}\n-->`);
      expect(parseKnowledgePublicationRecord(opened.body)?.commits).toContain(unpublished);
      await forge.merge({ number: 1, headSha: opened.headSha, method: "squash" });
      const after = await publish();
      // GitHub's own head never carried it: it stays local and is published on its own.
      expect(await isAncestor(root, unpublished, "HEAD")).toBe(true);
      expect(after).toMatchObject({
        state: { status: "open", pullRequestNumber: 2, commitCount: 1 },
      });
      expect(parseKnowledgePublicationRecord(forge.pullRequests[1]!.body)?.commits).toEqual([
        unpublished,
      ]);
    },
  );

  it(
    "recognizes a pull request merged before records existed from GitHub's own head",
    { timeout: 60_000 },
    async () => {
      const { root, remote, forge, publish } = await setup({ merge: "never" });
      await commit(root, "docs/runtime.md", "# Runtime\n\nFirst.\n", knowledge);
      await commit(root, "src/app.ts", "export {};\n", developer, "feat: local work");
      await publish();
      // A publication from before records: its body names nothing.
      forge.pullRequests[0]!.body = "## Summary\n\nAn older publication.\n";
      const opened = forge.pullRequests[0]!;
      await forge.merge({ number: 1, headSha: opened.headSha, method: "squash" });
      await advanceRemoteMain(remote, "docs/runtime.md", "# Runtime\n\nA person's edit.\n");
      await forgetLocalState(root);
      await publish();
      expect(forge.pullRequests).toHaveLength(1);
      expect((await readKnowledgeSupersessionLedger(root))?.entries ?? []).toEqual([]);
    },
  );

  it(
    "keeps a person's close a decline when GitHub no longer serves its head",
    { timeout: 60_000 },
    async () => {
      const { root, forge, publish } = await setup();
      await commit(root, "docs/runtime.md", "# Runtime\n\nFirst.\n", knowledge);
      await publish();
      await forge.closeByPerson(1);
      forge.unservedPullHeads.add(1);
      // Its record names what it carried, which can only hold commits back: no republish.
      await expect(publish()).resolves.toMatchObject({
        state: { status: "idle", declined: [{ pullRequestNumber: 1, commitCount: 1 }] },
      });
      expect(forge.pullRequests).toHaveLength(1);
    },
  );

  it(
    "reads a pull request again once it is reopened and closed at a new head",
    { timeout: 60_000 },
    async () => {
      const { root, forge, publish } = await setup({ merge: "never" });
      await commit(root, "docs/a.md", "# A\n", knowledge);
      await publish();
      await forge.closeByPerson(1);
      await expect(publish()).resolves.toMatchObject({
        state: { declined: [{ pullRequestNumber: 1, commitCount: 1 }] },
      });
      // A person reopens it, replaces its head with another of Lervo's commits, and closes it.
      await commit(root, "docs/b.md", "# B\n", knowledge);
      const second = await git(root, ["rev-parse", "HEAD"]);
      await git(root, [
        "push",
        "--quiet",
        "--force",
        "origin",
        `${second}:refs/heads/lervo/knowledge-outputs`,
      ]);
      // Both happen between two cycles, so Lervo never sees it open: only its head tells.
      forge.pullRequests[0]!.state = "open";
      await forge.closeByPerson(1);
      // Its patches are read again for the new head: both commits are now held back by it.
      await expect(publish()).resolves.toMatchObject({
        state: { declined: [{ pullRequestNumber: 1, commitCount: 2 }] },
      });
    },
  );

  it("keeps the cache within its budget, dropping the oldest patches first", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-publication-cache-"));
    directories.push(root);
    const many = (count: number) =>
      Array.from({ length: count }, (_, index) => index.toString(16).padStart(40, "0"));
    const patches = Object.fromEntries(
      Array.from({ length: 450 }, (_, index) => [`${index + 1}:${sha("a")}`, many(1_000)]),
    );
    const base = {
      schemaVersion: 2 as const,
      repository: "example/repository",
      history: { through: null, pullRequests: [], pullPatches: patches },
      local: null,
    };
    await expect(writeKnowledgePublicationHistoryCache(root, base)).resolves.toEqual({
      historyDropped: false,
    });
    const kept = (await readKnowledgePublicationHistoryCache(root))!.history.pullPatches;
    expect(Object.keys(kept).length).toBeLessThan(450);
    expect(kept[`450:${sha("a")}`]).toBeDefined();
    expect(kept[`1:${sha("a")}`]).toBeUndefined();
    // A history whose pull requests alone exceed the budget is dropped, and the caller is told.
    const entry = (number: number) => ({
      number,
      merged: false,
      headSha: sha("b"),
      mergeCommit: null,
      mergedAt: null,
      updatedAt: "2026-11-21T00:00:00.000Z",
      record: "x".repeat(400),
    });
    const huge = {
      ...base,
      history: {
        ...base.history,
        pullPatches: {},
        pullRequests: Array.from({ length: 45_000 }, (_, index) => entry(index + 1)),
      },
    };
    await expect(writeKnowledgePublicationHistoryCache(root, huge)).resolves.toEqual({
      historyDropped: true,
    });
    expect((await readKnowledgePublicationHistoryCache(root))!.history.pullRequests).toEqual([]);
  });

  it(
    "publishes again after a person deleted the branch, which closed its pull request",
    { timeout: 60_000 },
    async () => {
      const { root, forge, publish } = await setup();
      await commit(root, "docs/runtime.md", "# Runtime\n\nFirst.\n", knowledge);
      await publish();
      await forge.deleteBranchByPerson(1);
      await expect(publish()).resolves.toMatchObject({
        state: { status: "awaiting_checks", pullRequestNumber: 2 },
      });
      expect(await readKnowledgePublicationState(root)).not.toHaveProperty("declined");
    },
  );

  it(
    "names a merged pull request whose head GitHub does not serve, and tolerates a closed one",
    { timeout: 60_000 },
    async () => {
      const { root, forge, publish } = await setup({ merge: "never" });
      // Two commits, so the squash's patch is neither's and Git's own check cannot tell.
      await commit(root, "docs/a.md", "# A\n\nFirst.\n", knowledge);
      await commit(root, "docs/a.md", "# A\n\nSecond.\n", knowledge);
      await commit(root, "src/app.ts", "export {};\n", developer, "feat: local work");
      await publish();
      const opened = forge.pullRequests[0]!;
      await forge.merge({ number: 1, headSha: opened.headSha, method: "squash" });
      forge.unservedPullHeads.add(1);
      // Nothing can prove what #1 carried: nothing is published, and the failure says why.
      await expect(publish()).resolves.toMatchObject({
        state: {
          status: "failed",
          failure: {
            code: "knowledge_publication_pull_head_unavailable",
            detail: "refs/pull/1/head unavailable",
          },
        },
        // Tried again at the transient backoff, then named attention until GitHub serves it.
        retryAfterMs: 2 * 60_000,
      });
      expect(forge.pullRequests).toHaveLength(1);
      // Once GitHub serves it again, its commits count as published.
      forge.unservedPullHeads.clear();
      await expect(publish()).resolves.toMatchObject({ state: { failure: null } });
      expect(forge.pullRequests).toHaveLength(1);
    },
  );

  it(
    "keeps commits published whatever this host's clock said when it authored them",
    { timeout: 60_000 },
    async () => {
      const { root, remote, forge, publish } = await setup({ merge: "never" });
      // A host clock a day ahead, then one a year behind: no clock decides what merged.
      const ahead = new Date(Date.now() + 24 * 60 * 60_000).toISOString();
      const behind = new Date(Date.now() - 365 * 24 * 60 * 60_000).toISOString();
      await commit(root, "docs/runtime.md", "# Runtime\n\nFirst.\n", {
        ...knowledge,
        GIT_AUTHOR_DATE: ahead,
      });
      await commit(root, "docs/runtime.md", "# Runtime\n\nSecond.\n", {
        ...knowledge,
        GIT_AUTHOR_DATE: behind,
      });
      await commit(root, "src/app.ts", "export {};\n", developer, "feat: local work");
      await publish();
      await forge.merge({ number: 1, headSha: forge.pullRequests[0]!.headSha, method: "squash" });
      await advanceRemoteMain(remote, "docs/runtime.md", "# Runtime\n\nA person's edit.\n");
      await forgetLocalState(root);
      await publish();
      expect(forge.pullRequests).toHaveLength(1);
      expect((await readKnowledgeSupersessionLedger(root))?.entries ?? []).toEqual([]);
    },
  );

  for (const method of ["squash", "rebase", "merge"] as const)
    it(
      `publishes again an identical change regenerated at once after a revert of a ${method}`,
      { timeout: 60_000 },
      async () => {
        const { root, remote, forge, publish } = await setup();
        forge.checkState = "passed";
        forge.policyValue = { ...forge.policyValue, mergeMethods: [method] };
        await commit(root, "docs/runtime.md", "# Runtime\n\nFirst.\n", knowledge);
        await expect(publish()).resolves.toMatchObject({ state: { status: "merged" } });
        // A person reverts it; within the same minute Lervo regenerates the same bytes, with an
        // author date even before the merge. Only its parent, which holds the merge, tells.
        await advanceRemoteMain(remote, "docs/runtime.md", "# Runtime\n");
        await git(root, ["pull", "--quiet", "--ff-only", "origin", "main"]);
        const early = new Date(Date.now() - 60 * 60_000).toISOString();
        await commit(root, "docs/runtime.md", "# Runtime\n\nFirst.\n", {
          ...knowledge,
          GIT_AUTHOR_DATE: early,
          GIT_COMMITTER_DATE: early,
        });
        await expect(publish()).resolves.toMatchObject({
          state: { status: "merged", commitCount: 1 },
        });
        expect(forge.pullRequests).toHaveLength(2);
      },
    );

  it(
    "reads only newer history, keyed by repository, across a host key change",
    { timeout: 60_000 },
    async () => {
      const { root, forge, publish } = await setup({ merge: "never" });
      await commit(root, "docs/a.md", "# A\n", knowledge);
      await commit(root, "src/app.ts", "export {};\n", developer, "feat: local work");
      await publish();
      await forge.merge({ number: 1, headSha: forge.pullRequests[0]!.headSha, method: "squash" });
      await publish();
      expect(forge.historySince).toEqual([undefined, undefined]);
      // Once a read saw a closed pull request, the next asks only for changes since, less the
      // overlap.
      await commit(root, "src/next.ts", "export {};\n", developer, "feat: next");
      await publish();
      expect(forge.historySince.at(-1)).toEqual(expect.any(String));
      // A new host key keeps the repository's history; the read stays incremental.
      const path = resolve(root, KNOWLEDGE_PUBLICATION_HISTORY_PATH);
      const cached = JSON.parse(await readFile(path, "utf8")) as {
        local: { hostHash: string };
      };
      await writeFile(
        path,
        JSON.stringify({ ...cached, local: { ...cached.local, hostHash: "sha256:other" } }),
      );
      await commit(root, "src/more.ts", "export {};\n", developer, "feat: more work");
      await publish();
      expect(forge.historySince.at(-1)).toEqual(expect.any(String));
      // Another repository's history is not reused.
      forge.repositoryName = "example/other";
      await commit(root, "src/again.ts", "export {};\n", developer, "feat: again");
      await publish();
      expect(forge.historySince.at(-1)).toBeUndefined();
    },
  );

  it(
    "fetches pull heads one by one when a batch fails, and names the ones GitHub does not serve",
    { timeout: 60_000 },
    async () => {
      const { root, remote } = await setup();
      await commit(root, "docs/a.md", "# A\n\nFirst.\n", knowledge);
      const head = await git(root, ["rev-parse", "HEAD"]);
      await git(root, ["push", "--quiet", "origin", `${head}:refs/pull/1/head`]);
      // #2 has no head on the remote: the batch fetch of both fails, and #1 is still read.
      const settings = { remote: "origin" } as Parameters<
        typeof pullRequestPatchIds
      >[0]["settings"];
      const base = await git(root, ["rev-parse", "HEAD~1"]);
      const { patches, missing } = await pullRequestPatchIds({
        root,
        settings,
        base,
        pullRequests: [
          { number: 1, mergeCommit: null },
          { number: 2, mergeCommit: null },
        ],
      });
      expect(missing).toEqual([2]);
      expect(patches.get(1)).toHaveLength(1);
      expect(await git(remote, ["for-each-ref", "refs/pull"])).not.toContain("refs/pull/2");
    },
  );

  it("reads patch ids of a large backlog in bounded batches", { timeout: 120_000 }, async () => {
    const { root } = await setup();
    // 600 commits, created at once with fast-import, more than two batches.
    const base = await git(root, ["rev-parse", "HEAD"]);
    const lines: string[] = [];
    for (let index = 0; index < 600; index++)
      lines.push(
        "commit refs/heads/backlog",
        `committer Lervo Knowledge <knowledge@lervo.invalid> ${1_790_000_000 + index} +0000`,
        "data 4",
        "note",
        ...(index === 0 ? [`from ${base}`] : []),
        `M 100644 inline docs/backlog-${index}.md`,
        `data ${`# ${index}\n`.length}`,
        `# ${index}`,
        "",
      );
    await new Promise<void>((resolveImport, reject) => {
      const child = spawn("git", ["-C", root, "fast-import", "--quiet"], {
        stdio: ["pipe", "ignore", "pipe"],
      });
      child.on("close", (code) =>
        code === 0 ? resolveImport() : reject(new Error(`fast-import ${code}`)),
      );
      child.stdin.end(`${lines.join("\n")}\n`);
    });
    const commits = (await git(root, ["rev-list", "--reverse", `${base}..backlog`])).split("\n");
    expect(commits).toHaveLength(600);
    const patches = await localPatches(root, commits);
    expect(patches.size).toBe(600);
    expect(new Set([...patches.values()].map((item) => item.patch)).size).toBe(600);
  });

  it(
    "asks GitHub again when the cache is missing, from another host, or for another head",
    { timeout: 60_000 },
    async () => {
      const { root, remote, forge, publish } = await setup();
      forge.checkState = "passed";
      await commit(root, "docs/runtime.md", "# Runtime\n\nFirst.\n", knowledge);
      await expect(publish()).resolves.toMatchObject({ state: { status: "merged" } });
      const reads = () => forge.historyCalls;
      let seen = reads();
      // The cache covers this host, base and head: nothing is asked.
      await expect(publish()).resolves.toEqual({ status: "unchanged" });
      expect(reads()).toBe(seen);
      const path = resolve(root, KNOWLEDGE_PUBLICATION_HISTORY_PATH);
      const cached = JSON.parse(await readFile(path, "utf8")) as {
        local: { hostHash: string };
      };
      // Another host's cache.
      await writeFile(
        path,
        JSON.stringify({
          ...cached,
          local: { ...cached.local, hostHash: `sha256:${"9".repeat(64)}` },
        }),
      );
      await expect(publish()).resolves.toMatchObject({ status: "published" });
      expect(reads()).toBe(++seen);
      await expect(publish()).resolves.toEqual({ status: "unchanged" });
      expect(reads()).toBe(seen);
      // A base the cache was not derived for: a merge may have landed.
      await advanceRemoteMain(remote, "src/upstream.ts", "export {};\n");
      await git(root, ["fetch", "--quiet", "origin"]);
      await publish();
      expect(reads()).toBe(++seen);
      await expect(publish()).resolves.toEqual({ status: "unchanged" });
      expect(reads()).toBe(seen);
      // A head the cache was not derived for.
      await commit(root, "src/app.ts", "export {};\n", developer, "feat: local work");
      await publish();
      expect(reads()).toBe(++seen);
      // No cache at all.
      await rm(path);
      await publish();
      expect(reads()).toBe(++seen);
      await expect(publish()).resolves.toEqual({ status: "unchanged" });
      expect(reads()).toBe(seen);
    },
  );

  it(
    "counts more than 64 publications, however old, without a cap",
    { timeout: 120_000 },
    async () => {
      const { root, remote, forge, publish } = await setup({ merge: "never" });
      // 70 knowledge commits a person squash-merged one by one, then reverted on the base.
      const carried: string[] = [];
      for (let index = 0; index < 70; index++) {
        await commit(root, `docs/note-${index}.md`, `# Note ${index}\n`, knowledge);
        carried.push(await git(root, ["rev-parse", "HEAD"]));
      }
      await commit(root, "src/app.ts", "export {};\n", developer, "feat: local work");
      // Their heads live on GitHub, as each pull request's `refs/pull/<n>/head`.
      await git(root, ["push", "--quiet", "origin", `${carried.at(-1)}:refs/heads/person-scratch`]);
      forge.pullRequests = carried.map((commitSha, index) => ({
        number: index + 1,
        url: `https://github.invalid/pull/${index + 1}`,
        state: "merged" as const,
        headSha: commitSha,
        title: "docs: publish reviewed background knowledge",
        // Merged before Lervo wrote records: GitHub's own heads are the backfill.
        body: "## Summary\n\nA publication from before pull request records.\n",
        mergeCommit: sha("e"),
        mergedAt: new Date(Date.now() + 60_000).toISOString(),
        updatedAt: new Date().toISOString(),
        head: "lervo/knowledge-outputs",
        base: "main",
      }));
      await advanceRemoteMain(remote, "docs/other.md", "# Other\n");
      const after = await publish();
      expect(after).toMatchObject({ state: { status: "idle", commitCount: 0 } });
      expect(forge.pullRequests).toHaveLength(70);
      const cache = await readKnowledgePublicationHistoryCache(root);
      expect(cache?.local?.published).toHaveLength(70);
    },
  );

  it(
    "counts a merge GitHub reports before its merge commit, and reads it again until it has one",
    { timeout: 60_000 },
    async () => {
      const { root, remote, forge, publish } = await setup();
      forge.checkState = "passed";
      forge.mergeCommitReported = false;
      await commit(root, "docs/runtime.md", "# Runtime\n\nFirst.\n", knowledge);
      await commit(root, "src/app.ts", "export {};\n", developer, "feat: local work");
      await expect(publish()).resolves.toMatchObject({
        state: { status: "local_diverged", failure: null },
      });
      expect(forge.merges).toBe(1);
      // Without its merge commit the next cycle asks GitHub again, and publishes nothing twice.
      const reads = forge.historyCalls;
      await publish();
      expect(forge.historyCalls).toBe(reads + 1);
      expect(forge.pullRequests).toHaveLength(1);
      // Once GitHub reports it, a later revert of the merged document is observed against it.
      forge.pullRequests[0]!.mergeCommit = await git(remote, ["rev-parse", "refs/heads/main"]);
      await advanceRemoteMain(remote, "docs/runtime.md", "# Runtime\n");
      await git(root, ["fetch", "--quiet", "origin"]);
      await publish();
      expect(await readKnowledgePublicationState(root)).toMatchObject({
        baseChanged: { pullRequestNumber: 1, paths: 1 },
      });
    },
  );

  it(
    "never marks a commit published that a person's force-push removed before the merge",
    { timeout: 60_000 },
    async () => {
      const { root, remote, forge, publish } = await setup({ merge: "never" });
      await commit(root, "docs/a.md", "# A\n", knowledge);
      const kept = await git(root, ["rev-parse", "HEAD"]);
      await commit(root, "docs/b.md", "# B\n", knowledge);
      const removed = await git(root, ["rev-parse", "HEAD"]);
      await publish();
      // A person rewrites the branch without the second commit, then merges the pull request.
      const other = await mkdtemp(resolve(tmpdir(), "lervo-publication-person-"));
      directories.push(other);
      const clone = resolve(other, "clone");
      await execute("git", ["clone", "--quiet", remote, clone]);
      await git(clone, ["checkout", "--quiet", "-B", "lervo/knowledge-outputs", kept]);
      await commit(clone, "docs/c.md", "# C\n", developer, "docs: a person's change");
      await git(clone, ["push", "--quiet", "--force", "origin", "lervo/knowledge-outputs"]);
      const opened = forge.pullRequests[0]!;
      await forge.merge({
        number: opened.number,
        headSha: await git(clone, ["rev-parse", "HEAD"]),
        method: "merge",
      });
      // The record names the head Lervo pushed, not the one that merged: the removed commit is
      // published again in its own pull request.
      await expect(publish()).resolves.toMatchObject({
        state: { status: "open", pullRequestNumber: 2, commitCount: 1 },
      });
      expect(parseKnowledgePublicationRecord(forge.pullRequests[1]!.body)?.commits).toEqual([
        removed,
      ]);
    },
  );

  it(
    "compares a base change with the merge commit, so formatting and other edits are none",
    { timeout: 60_000 },
    async () => {
      const formatter: KnowledgeOutputFormatter = {
        format: async (path, content) =>
          path.endsWith(".md") ? content.replace(/[ \t]+$/gmu, "") : null,
      };
      const { root, remote, forge, publish } = await setup({ formatter });
      forge.checkState = "passed";
      forge.policyValue = { ...forge.policyValue, mergeMethods: ["squash"] };
      // The publisher's own formatting commit changes the bytes the knowledge commit made.
      await commit(root, "docs/runtime.md", "# Runtime   \n\nFirst.  \n", knowledge);
      await expect(publish()).resolves.toMatchObject({ state: { status: "merged" } });
      await expect(publish()).resolves.toEqual({ status: "unchanged" });
      expect(await readKnowledgePublicationState(root)).not.toHaveProperty("baseChanged");
      // An ordinary later edit of another path is not a change of Lervo's outputs.
      await advanceRemoteMain(remote, "src/app.ts", "export {};\n");
      await git(root, ["fetch", "--quiet", "origin"]);
      await publish();
      expect(await readKnowledgePublicationState(root)).not.toHaveProperty("baseChanged");
      // A person's edit of the merged document is, until acknowledged.
      await advanceRemoteMain(remote, "docs/runtime.md", "# Runtime\n\nEdited.\n");
      await git(root, ["fetch", "--quiet", "origin"]);
      await publish();
      const changed = (await readKnowledgePublicationState(root))!.baseChanged!;
      expect(changed).toMatchObject({ pullRequestNumber: 1, paths: 1 });
      await expect(
        acknowledgeKnowledgePublicationAttention(root, await readKnowledgePublicationState(root)),
      ).resolves.toMatchObject({ baseChange: changed.key });
      // Another edit of the same path is a new change, with a new key.
      await advanceRemoteMain(remote, "docs/runtime.md", "# Runtime\n\nEdited again.\n");
      await git(root, ["fetch", "--quiet", "origin"]);
      await publish();
      expect((await readKnowledgePublicationState(root))!.baseChanged!.key).not.toBe(changed.key);
      expect((await readKnowledgePublicationAcknowledged(root))?.baseChange).toBe(changed.key);
    },
  );
});

describe("GitHub-side waits back off, then arm no timer (ADR-0602)", () => {
  const schedule = [2, 4, 8, 16, 32, 60].map((minutes) => minutes * 60_000);

  it(
    "waits on a head with no checks, then on a draft, at a growing interval, then not at all",
    { timeout: 120_000 },
    async () => {
      const { root, forge, publish } = await setup();
      forge.pendingReason = "none";
      await commit(root, "docs/runtime.md", "# Runtime\n\nFirst.\n", knowledge);
      for (const [index, delay] of [...schedule, null, null].entries())
        await expect(publish()).resolves.toMatchObject({
          state: {
            status: "awaiting_checks",
            wait: { kind: "checks", reason: "none", attempts: index + 1 },
          },
          retryAfterMs: delay,
        });
      // Checks pass, and the pull request is a draft: the same pull request and commits keep
      // counting, so changing what it waits on cannot restart the schedule.
      forge.checkState = "passed";
      forge.gateValue = "draft";
      await expect(publish()).resolves.toMatchObject({
        state: { wait: { kind: "gate", reason: "draft", attempts: 9 } },
        retryAfterMs: null,
      });
      expect(forge.merges).toBe(0);
      forge.gateValue = "ready";
      const merged = await publish();
      expect(merged).toMatchObject({ state: { status: "merged" } });
      expect(merged).not.toHaveProperty("state.wait");
    },
  );

  it(
    "keeps one head and one wait while the base keeps moving, so the wait runs out",
    { timeout: 180_000 },
    async () => {
      const { root, remote, forge, publish } = await setup();
      await commit(root, "docs/runtime.md", "# Runtime\n\nFirst.\n", knowledge);
      await expect(publish()).resolves.toMatchObject({ state: { wait: { attempts: 1 } } });
      const pushes = await branchUpdates(remote);
      // A busy base moves between every look; the open head carries the same change.
      for (const [index, delay] of [...schedule.slice(1), null, null].entries()) {
        await advanceRemoteMain(remote, `src/other-${index}.ts`, "export {};\n");
        await expect(publish()).resolves.toMatchObject({
          state: { wait: { kind: "checks", attempts: index + 2 } },
          retryAfterMs: delay,
        });
      }
      // No new push: its checks never restart and no review is dismissed.
      expect(await branchUpdates(remote)).toBe(pushes);
      // A gate that needs a new head rebuilds it, and the same wait goes on.
      forge.checkState = "passed";
      forge.gateValue = "behind";
      await advanceRemoteMain(remote, "src/last.ts", "export {};\n");
      await expect(publish()).resolves.toMatchObject({
        state: { wait: { kind: "gate", reason: "behind", attempts: 9 } },
        retryAfterMs: null,
      });
      expect(await branchUpdates(remote)).toBe(pushes + 1);
    },
  );

  it(
    "backs transient failures off together, whatever code each one has",
    { timeout: 120_000 },
    async () => {
      const { root, forge, publish } = await setup();
      forge.checkState = "passed";
      await commit(root, "docs/runtime.md", "# Runtime\n\nFirst.\n", knowledge);
      const network = (operation: "find" | "merge") =>
        new KnowledgePublicationForgeError(operation, 1, "network");
      const delays: (number | null)[] = [];
      const codes: string[] = [];
      for (let index = 0; index < 4; index++) {
        forge.findError = index % 2 === 0 ? network("find") : null;
        forge.mergeError = index % 2 === 1 ? network("merge") : null;
        const outcome = (await publish()) as {
          state: { failure: { code: string } };
          retryAfterMs: number | null;
        };
        delays.push(outcome.retryAfterMs);
        codes.push(outcome.state.failure.code);
      }
      expect(codes).toEqual([
        "knowledge_publication_pull_request_failed",
        "knowledge_publication_merge_failed",
        "knowledge_publication_pull_request_failed",
        "knowledge_publication_merge_failed",
      ]);
      expect(delays).toEqual([2, 4, 8, 16].map((minutes) => minutes * 60_000));
      // A cycle without a transient failure ends the streak.
      forge.findError = null;
      forge.mergeError = null;
      await expect(publish()).resolves.toMatchObject({ state: { status: "merged" } });
      expect(await readKnowledgePublicationState(root)).not.toHaveProperty("transientFailures");
    },
  );

  it("enters a merge queue and counts the merge it makes", { timeout: 60_000 }, async () => {
    const { root, forge, publish } = await setup();
    forge.checkState = "passed";
    forge.gateValue = async () => (forge.queued.has(1) ? "queued" : "queue");
    await commit(root, "docs/runtime.md", "# Runtime\n\nFirst.\n", knowledge);
    await expect(publish()).resolves.toMatchObject({
      state: { status: "awaiting_checks", wait: { kind: "gate", reason: "queued" } },
      retryAfterMs: 2 * 60_000,
    });
    expect(forge.mergeMethods).toEqual(["queue"]);
    await expect(publish()).resolves.toMatchObject({
      state: { wait: { kind: "gate", reason: "queued", attempts: 2 } },
    });
    // The queue merges with its own method.
    await forge.land(1, "squash");
    await expect(publish()).resolves.toMatchObject({ state: { status: "merged" } });
    expect(forge.pullRequests).toHaveLength(1);
  });
});
