import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { KNOWLEDGE_OUTPUT_COMMIT_AUTHOR } from "./knowledge-output-commit.js";
import type { KnowledgePublicationSettings } from "./knowledge-publication-settings.js";

const execute = promisify(execFile);
const MAXIMUM_PUBLISHED_COMMITS = 64;

export class KnowledgePublicationGitError extends Error {
  constructor(
    readonly stage: "fetch" | "inspect" | "rebuild" | "push" | "sync" | "supersede" | "repair",
    readonly exitCode: number | null,
    options?: ErrorOptions,
  ) {
    super(`Knowledge publication Git ${stage} failed.`, options);
    this.name = "KnowledgePublicationGitError";
  }
}

export async function git(
  root: string,
  args: string[],
  stage: KnowledgePublicationGitError["stage"],
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  try {
    const { stdout } = await execute("git", ["-C", root, ...args], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 120_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...env },
    });
    return stdout;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    throw new KnowledgePublicationGitError(stage, typeof code === "number" ? code : null, {
      cause: error,
    });
  }
}

export const tracking = (settings: KnowledgePublicationSettings, branch: string) =>
  `refs/remotes/${settings.remote}/${branch}`;

/*
 * ADR-0603: the local base catches up by content, never by ancestry or patch identity alone, so
 * no merge method (a merge commit, a squash, a rebase) can make Lervo drop work it did not publish.
 */

async function pathsOf(
  root: string,
  commits: readonly string[],
  stage: KnowledgePublicationGitError["stage"],
): Promise<string[]> {
  const paths = new Set<string>();
  for (const sha of commits)
    for (const path of (
      await git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", sha], stage)
    ).split("\0"))
      if (path !== "") paths.add(path);
  return [...paths];
}

/**
 * Whether `left` and `right` hold the same bytes, or the same absence, at every path. Git exits 1
 * for a difference; any other failure is an error, never an answer.
 */
export async function sameBytes(
  root: string,
  left: string,
  right: string,
  paths: readonly string[],
  stage: KnowledgePublicationGitError["stage"],
): Promise<boolean> {
  if (paths.length === 0) return true;
  return git(root, ["diff", "--quiet", "--no-renames", left, right, "--", ...paths], stage).then(
    () => true,
    (error: unknown) => {
      if (error instanceof KnowledgePublicationGitError && error.exitCode === 1) return false;
      throw error;
    },
  );
}

/** Fetches the base and publication branches into their remote-tracking refs. */
export async function fetchKnowledgePublicationRefs(
  root: string,
  settings: KnowledgePublicationSettings,
): Promise<void> {
  await git(
    root,
    [
      "fetch",
      "--quiet",
      "--no-tags",
      settings.remote,
      `+refs/heads/${settings.baseBranch}:${tracking(settings, settings.baseBranch)}`,
    ],
    "fetch",
  );
  // The publication branch is absent until the first push and after a merged branch is deleted.
  await git(
    root,
    [
      "fetch",
      "--quiet",
      "--no-tags",
      settings.remote,
      `+refs/heads/${settings.branch}:${tracking(settings, settings.branch)}`,
    ],
    "fetch",
  ).catch(() =>
    git(root, ["update-ref", "-d", tracking(settings, settings.branch)], "fetch").catch(() => ""),
  );
}

export async function remoteTrackingHead(
  root: string,
  settings: KnowledgePublicationSettings,
  branch: string,
): Promise<string | null> {
  const value = await git(
    root,
    ["rev-parse", "--verify", "--quiet", `${tracking(settings, branch)}^{commit}`],
    "inspect",
  ).catch(() => "");
  return value.trim() === "" ? null : value.trim();
}

export interface KnowledgePublicationCommit {
  sha: string;
  subject: string;
  body: string;
  paths: string[];
  /** Raw committer date (`<epoch> <zone>`), reused by replay so identical input replays identically. */
  committerDate: string;
}

export interface KnowledgePublicationInventory {
  head: string;
  base: string;
  /** Unpublished knowledge commits, oldest first, excluding patches already in the base. */
  knowledge: KnowledgePublicationCommit[];
  /** Commits in `base..HEAD` that are not unpublished knowledge commits: developer work, merges, superseded or deferred knowledge commits, or patches already upstream. */
  otherCount: number;
  /** The part of `otherCount` that a reset would lose: developer work and merges not upstream. */
  developerCount: number;
  /** Every commit in `base..head`, which bounds the cached publication history (ADR-0603). */
  rangeCommits: string[];
  /** Every unpublished knowledge commit, also beyond the 64 one pull request carries. */
  candidateCommits: string[];
}

/**
 * Lists `base..HEAD`. A knowledge commit is a non-merge commit whose author and committer are
 * both the `Lervo Knowledge` identity; nothing else is ever published. Superseded commits, which
 * an earlier replay conflict excluded, and declined commits, whose pull request a person closed
 * without merge, stay local and are never selected again. ADR-0603: a
 * knowledge commit is already upstream when its patch is in the base, or when a merged pull
 * request carried its patch (`published`, from GitHub's own pull request heads), which is how a
 * squash or a rebase lands it.
 */
export async function inventoryKnowledgePublication(
  root: string,
  settings: KnowledgePublicationSettings,
  superseded: ReadonlySet<string> = new Set(),
  published: ReadonlySet<string> = new Set(),
): Promise<KnowledgePublicationInventory | null> {
  const base = await remoteTrackingHead(root, settings, settings.baseBranch);
  if (base === null) return null;
  const head = (await git(root, ["rev-parse", "HEAD"], "inspect")).trim();
  const range = `${base}..${head}`;
  const upstream = new Set(
    (await git(root, ["cherry", base, head], "inspect"))
      .split("\n")
      .filter((line) => line.startsWith("- "))
      .map((line) => line.slice(2).trim()),
  );
  const log = await git(
    root,
    [
      "log",
      "--reverse",
      "--date=raw",
      "--format=%H%x00%P%x00%ae%x00%ce%x00%cd%x00%s%x00%b%x1e",
      range,
    ],
    "inspect",
  );
  const records = log
    .split("\x1e")
    .map((record) => record.replace(/^\n/u, "").split("\0"))
    .filter(([sha]) => sha !== undefined && sha.trim() !== "")
    .map(([sha, parents, author, committer, committerDate, subject, body]) => ({
      sha: sha!,
      knowledgeIdentity:
        parents!.trim().split(" ").length === 1 &&
        author === KNOWLEDGE_OUTPUT_COMMIT_AUTHOR.email &&
        committer === KNOWLEDGE_OUTPUT_COMMIT_AUTHOR.email,
      committerDate,
      subject,
      body,
    }));
  for (const sha of published) upstream.add(sha);
  const knowledge: KnowledgePublicationCommit[] = [];
  let otherCount = 0;
  let developerCount = 0;
  for (const { sha, knowledgeIdentity, committerDate, subject, body } of records) {
    if (!knowledgeIdentity || upstream.has(sha) || superseded.has(sha)) {
      otherCount++;
      if (!knowledgeIdentity && !upstream.has(sha)) developerCount++;
      continue;
    }
    const paths = (
      await git(root, ["diff-tree", "--no-commit-id", "--name-only", "-r", "-z", sha], "inspect")
    )
      .split("\0")
      .filter((path) => path !== "");
    knowledge.push({
      sha,
      subject: subject ?? "",
      body: (body ?? "").trim(),
      paths,
      committerDate: committerDate ?? "",
    });
  }
  // One pull request carries at most 64 commits; the rest follow after it merges. Deferred
  // commits count as other work, so the tip is then replayed instead of being `HEAD`.
  const candidateCommits = knowledge.map((commit) => commit.sha);
  if (knowledge.length > MAXIMUM_PUBLISHED_COMMITS)
    otherCount += knowledge.splice(MAXIMUM_PUBLISHED_COMMITS).length;
  return {
    head,
    base,
    knowledge,
    otherCount,
    developerCount,
    rangeCommits: records.map((record) => record.sha),
    candidateCommits,
  };
}

/** Pushes the tip with a lease on the observed branch head; never touches the base branch. */
export async function pushKnowledgePublicationTip(
  root: string,
  settings: KnowledgePublicationSettings,
  tip: string,
  expectedRemoteHead: string | null,
): Promise<void> {
  if (expectedRemoteHead === tip) return;
  await git(
    root,
    [
      "push",
      "--quiet",
      "--no-verify",
      `--force-with-lease=refs/heads/${settings.branch}:${expectedRemoteHead ?? ""}`,
      settings.remote,
      `${tip}:refs/heads/${settings.branch}`,
    ],
    "push",
  );
  await git(root, ["update-ref", tracking(settings, settings.branch), tip], "push");
}

/**
 * After a merge, brings the local base branch to the remote base when no work can be lost:
 * a fast-forward, or `reset --keep` when every local-only commit is a non-merge commit whose
 * change the base already holds. ADR-0603: that is judged by content, every path the local-only
 * commits touched having the same bytes on both, so a squash or rebase merge resets as cleanly as
 * a merge commit. `reset --keep` also refuses when uncommitted edits touch changed paths.
 */
export async function syncLocalBaseAfterPublication(
  root: string,
  settings: KnowledgePublicationSettings,
  published: ReadonlySet<string> = new Set(),
): Promise<"current" | "fast_forwarded" | "reset_to_equivalent" | "diverged" | "not_on_base"> {
  const branch = (
    await git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], "sync").catch(() => "")
  ).trim();
  if (branch !== settings.baseBranch) return "not_on_base";
  const base = await remoteTrackingHead(root, settings, settings.baseBranch);
  if (base === null) return "diverged";
  const head = (await git(root, ["rev-parse", "HEAD"], "sync")).trim();
  if (head === base) return "current";
  const ancestor = await git(root, ["merge-base", "--is-ancestor", head, base], "sync").then(
    () => true,
    () => false,
  );
  if (ancestor) {
    await git(root, ["merge", "--ff-only", "--quiet", base], "sync");
    return "fast_forwarded";
  }
  const merges = (await git(root, ["rev-list", "--merges", `${base}..${head}`], "sync")).trim();
  if (merges !== "") return "diverged";
  const unique = (await git(root, ["cherry", base, head], "sync"))
    .split("\n")
    .filter((line) => line.startsWith("+ "))
    .map((line) => line.slice(2).trim())
    // ADR-0603: a commit a merged publication carried is published, whatever the base holds now.
    .filter((sha) => !published.has(sha));
  if (!(await sameBytes(root, base, head, await pathsOf(root, unique, "sync"), "sync")))
    return "diverged";
  await git(root, ["reset", "--keep", "--quiet", base], "sync");
  return "reset_to_equivalent";
}
