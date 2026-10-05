import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { KNOWLEDGE_OUTPUT_COMMIT_AUTHOR } from "./knowledge-output-commit.js";
import type { KnowledgePublicationSettings } from "./knowledge-publication-settings.js";

const execute = promisify(execFile);
const MAXIMUM_PUBLISHED_COMMITS = 64;

export class KnowledgePublicationGitError extends Error {
  constructor(
    readonly stage: "fetch" | "inspect" | "rebuild" | "push" | "sync" | "supersede",
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
}

/**
 * Lists `base..HEAD`. A knowledge commit is a non-merge commit whose author and committer are
 * both the `Lervo Knowledge` identity; nothing else is ever published. Superseded commits, which
 * an earlier replay conflict excluded, stay local and are never selected again.
 */
export async function inventoryKnowledgePublication(
  root: string,
  settings: KnowledgePublicationSettings,
  superseded: ReadonlySet<string> = new Set(),
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
  const knowledge: KnowledgePublicationCommit[] = [];
  let otherCount = 0;
  let developerCount = 0;
  for (const record of log.split("\x1e")) {
    const [sha, parents, author, committer, committerDate, subject, body] = record
      .replace(/^\n/u, "")
      .split("\0");
    if (sha === undefined || sha.trim() === "") continue;
    const knowledgeIdentity =
      parents!.trim().split(" ").length === 1 &&
      author === KNOWLEDGE_OUTPUT_COMMIT_AUTHOR.email &&
      committer === KNOWLEDGE_OUTPUT_COMMIT_AUTHOR.email;
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
  if (knowledge.length > MAXIMUM_PUBLISHED_COMMITS)
    otherCount += knowledge.splice(MAXIMUM_PUBLISHED_COMMITS).length;
  return { head, base, knowledge, otherCount, developerCount };
}

/** Paths outside the allowed roots, across every commit; empty means publishable. */
export function knowledgePublicationScopeViolations(
  commits: readonly KnowledgePublicationCommit[],
  allowedRoots: readonly string[],
): string[] {
  return [
    ...new Set(
      commits.flatMap((commit) =>
        commit.paths.filter((path) => !allowedRoots.some((root) => path.startsWith(root))),
      ),
    ),
  ].sort();
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
 * a fast-forward, or `reset --keep` when every local-only commit is a non-merge patch already
 * upstream. `reset --keep` also refuses when uncommitted edits touch changed paths.
 */
export async function syncLocalBaseAfterPublication(
  root: string,
  settings: KnowledgePublicationSettings,
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
  const unique = (await git(root, ["cherry", base, head], "sync"))
    .split("\n")
    .filter((line) => line.startsWith("+ "));
  if (merges !== "" || unique.length > 0) return "diverged";
  await git(root, ["reset", "--keep", "--quiet", base], "sync");
  return "reset_to_equivalent";
}
