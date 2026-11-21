import { spawn } from "node:child_process";

import { git, KnowledgePublicationGitError } from "./knowledge-publication-git.js";
import type { KnowledgePublicationSettings } from "./knowledge-publication-settings.js";

/**
 * ADR-0607: what a closed pull request actually carried, read from GitHub's own ref for its head,
 * never from its body. Each commit is reduced to a zero-context patch id, so a replay onto a moved
 * base still matches the local commit it came from, while an edited body cannot claim a commit
 * the pull request never carried.
 */

const PULL_REF = "refs/lervo/publication-pulls";
const FETCH_CHUNK = 100;
/** Commits per `git log` call, which bounds its argument list. */
const PATCH_BATCH = 256;

/**
 * Runs `git log -p -U0 <args>` into `git patch-id --stable` as a stream, so no patch text is held
 * in memory however large the backlog; only one short line per commit is collected.
 */
function streamPatchIds(root: string, logArgs: readonly string[]): Promise<Map<string, string>> {
  return new Promise((resolveIds, reject) => {
    const fail = (error: unknown, exitCode: number | null = null) =>
      reject(new KnowledgePublicationGitError("inspect", exitCode, { cause: error }));
    const log = spawn(
      "git",
      [
        "-C",
        root,
        "log",
        "--no-merges",
        "-p",
        "-U0",
        "--no-color",
        "--format=commit %H",
        ...logArgs,
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    const patchId = spawn("git", ["-C", root, "patch-id", "--stable"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    log.stdout.pipe(patchId.stdin);
    let output = "";
    patchId.stdout.setEncoding("utf8");
    patchId.stdout.on("data", (chunk: string) => (output += chunk));
    let logExit: number | null | undefined;
    log.on("error", fail);
    patchId.on("error", fail);
    log.on("close", (code) => (logExit = code));
    patchId.on("close", (code) => {
      if (code !== 0 || (logExit !== undefined && logExit !== 0)) {
        fail(new Error("git patch-id failed"), code ?? logExit ?? null);
        return;
      }
      const ids = new Map<string, string>();
      for (const line of output.split("\n")) {
        const [patch, commit] = line.trim().split(" ");
        if (patch !== undefined && commit !== undefined && patch !== "") ids.set(commit, patch);
      }
      resolveIds(ids);
    });
  });
}

export interface LocalPatch {
  patch: string;
}

/** Zero-context patch ids of the given local commits, in bounded batches. */
export async function localPatches(
  root: string,
  commits: readonly string[],
): Promise<Map<string, LocalPatch>> {
  const result = new Map<string, LocalPatch>();
  for (let index = 0; index < commits.length; index += PATCH_BATCH) {
    const ids = await streamPatchIds(root, [
      "--no-walk=unsorted",
      ...commits.slice(index, index + PATCH_BATCH),
    ]);
    for (const [sha, patch] of ids) result.set(sha, { patch });
  }
  return result;
}

/**
 * ADR-0607: `sha:number` for each local commit whose parent already contains merged pull request
 * `number`'s merge commit, so the commit was built after that merge. A merge commit this checkout
 * does not have leaves the commit published, which is the safe side. Each merge commit, parent
 * and pair is asked of git once, however many pull requests carried the same patch.
 */
export async function builtAfterMerges(
  root: string,
  pairs: readonly { sha: string; number: number; mergeCommit: string | null }[],
): Promise<Set<string>> {
  const present = new Map<string, Promise<boolean>>();
  const parents = new Map<string, Promise<string>>();
  const ancestry = new Map<string, Promise<boolean>>();
  const once = <T>(cache: Map<string, Promise<T>>, key: string, ask: () => Promise<T>) => {
    let answer = cache.get(key);
    if (answer === undefined) cache.set(key, (answer = ask()));
    return answer;
  };
  const after = new Set<string>();
  for (const { sha, number, mergeCommit } of pairs) {
    if (mergeCommit === null) continue;
    const local = await once(present, mergeCommit, () =>
      git(root, ["cat-file", "-e", `${mergeCommit}^{commit}`], "inspect").then(
        () => true,
        () => false,
      ),
    );
    if (!local) continue;
    // A root commit has no parent and was built on nothing.
    const parent = await once(parents, sha, () =>
      git(root, ["rev-parse", "--verify", "--quiet", `${sha}^`], "inspect").then(
        (output) => output.trim(),
        () => "",
      ),
    );
    if (parent === "") continue;
    const built = await once(ancestry, `${mergeCommit} ${parent}`, () =>
      git(root, ["merge-base", "--is-ancestor", mergeCommit, parent], "inspect").then(
        () => true,
        (error: unknown) => {
          if (error instanceof KnowledgePublicationGitError && error.exitCode === 1) return false;
          throw error;
        },
      ),
    );
    if (built) after.add(`${sha}:${number}`);
  }
  return after;
}

/**
 * Fetches each pull request's head into a private ref, tolerating any that GitHub does not serve:
 * a failed batch is fetched one ref at a time, and the numbers it could not fetch are returned.
 */
async function fetchPullHeads(
  root: string,
  settings: KnowledgePublicationSettings,
  numbers: readonly number[],
): Promise<number[]> {
  const fetch = (batch: readonly number[]) =>
    git(
      root,
      [
        "fetch",
        "--quiet",
        "--no-tags",
        settings.remote,
        ...batch.map((number) => `+refs/pull/${number}/head:${PULL_REF}/${number}`),
      ],
      "fetch",
    );
  const missing: number[] = [];
  for (let index = 0; index < numbers.length; index += FETCH_CHUNK) {
    const batch = numbers.slice(index, index + FETCH_CHUNK);
    const fetched = await fetch(batch).then(
      () => true,
      () => false,
    );
    if (fetched) continue;
    for (const number of batch)
      await fetch([number]).catch(() => {
        missing.push(number);
      });
  }
  return missing;
}

/**
 * The patch ids each pull request's head carried, fetched from `refs/pull/<n>/head`, and the
 * pull requests whose head GitHub did not serve. The range is `merge-base(base, head)..head`; for
 * a pull request merged with a merge commit, whose head the base already contains, the fork point
 * is the merge commit's first parent. A head the base contains without a known merge commit
 * carries nothing here: Git's own patch check already sees those commits upstream.
 */
export async function pullRequestPatchIds(input: {
  root: string;
  settings: KnowledgePublicationSettings;
  base: string;
  pullRequests: readonly { number: number; mergeCommit: string | null }[];
}): Promise<{ patches: Map<number, string[]>; missing: number[] }> {
  const { root, settings } = input;
  const patches = new Map<number, string[]>();
  if (input.pullRequests.length === 0) return { patches, missing: [] };
  const missing = await fetchPullHeads(
    root,
    settings,
    input.pullRequests.map((pull) => pull.number),
  );
  const ancestor = (left: string, right: string) =>
    git(root, ["merge-base", "--is-ancestor", left, right], "inspect").then(
      () => true,
      (error: unknown) => {
        if (error instanceof KnowledgePublicationGitError && error.exitCode === 1) return false;
        throw error;
      },
    );
  try {
    for (const pull of input.pullRequests) {
      if (missing.includes(pull.number)) continue;
      const head = (
        await git(root, ["rev-parse", `${PULL_REF}/${pull.number}^{commit}`], "inspect")
      ).trim();
      // A merge commit this checkout does not have yet reads as unknown, not as an error.
      const mergeCommit =
        pull.mergeCommit === null
          ? null
          : await git(root, ["cat-file", "-e", `${pull.mergeCommit}^{commit}`], "inspect").then(
              () => pull.mergeCommit,
              () => null,
            );
      let other = input.base;
      if (mergeCommit !== null && (await ancestor(head, mergeCommit))) {
        const parents = (
          await git(root, ["rev-list", "--parents", "-n", "1", mergeCommit], "inspect")
        )
          .trim()
          .split(" ")
          .slice(1);
        if (parents.length >= 2) other = parents[0]!;
      }
      const fork = (await git(root, ["merge-base", other, head], "inspect")).trim();
      patches.set(
        pull.number,
        fork === head ? [] : [...(await streamPatchIds(root, [`${fork}..${head}`])).values()],
      );
    }
  } finally {
    const refs = await git(root, ["for-each-ref", "--format=%(refname)", PULL_REF], "inspect")
      .then((lines) => lines.split("\n").filter((ref) => ref !== ""))
      .catch(() => [] as string[]);
    for (const ref of refs) await git(root, ["update-ref", "-d", ref], "inspect").catch(() => "");
  }
  return { patches, missing };
}

/**
 * ADR-0603: whether the remote head carries the same change as `tip`, each against its own fork
 * from the base: a head the base moved past but whose change is unchanged needs no new push.
 */
export async function samePublishedChange(
  root: string,
  base: string,
  tip: string,
  remoteHead: string,
): Promise<boolean> {
  const fork = (await git(root, ["merge-base", base, remoteHead], "inspect")).trim();
  const [published, built] = await Promise.all([
    diffPatchId(root, fork, remoteHead),
    diffPatchId(root, base, tip),
  ]);
  return published !== null && published === built;
}

/** The zero-context patch id of the diff between two commits, or null for an empty one. */
function diffPatchId(root: string, from: string, to: string): Promise<string | null> {
  return new Promise((resolveId, reject) => {
    const fail = (error: unknown) =>
      reject(new KnowledgePublicationGitError("inspect", null, { cause: error }));
    const diff = spawn("git", ["-C", root, "diff", "-U0", "--no-color", "--no-renames", from, to], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    const patchId = spawn("git", ["-C", root, "patch-id", "--stable"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    patchId.stdin.write(`commit ${"0".repeat(40)}\n`);
    diff.stdout.pipe(patchId.stdin);
    let output = "";
    patchId.stdout.setEncoding("utf8");
    patchId.stdout.on("data", (chunk: string) => (output += chunk));
    diff.on("error", fail);
    patchId.on("error", fail);
    patchId.on("close", (code) => {
      if (code !== 0) {
        fail(new Error("git patch-id failed"));
        return;
      }
      resolveId(output.trim().split(" ")[0] || null);
    });
  });
}
