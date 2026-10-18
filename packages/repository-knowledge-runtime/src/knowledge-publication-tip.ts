import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { KNOWLEDGE_OUTPUT_COMMIT_IDENTITY } from "./knowledge-output-commit.js";
import { readRevisionFiles, revisionRangeFormatTargets } from "./knowledge-output-format-scope.js";
import {
  formatKnowledgeOutputFiles,
  unformattedKnowledgeOutputs,
  type KnowledgeOutputFormatter,
} from "./knowledge-output-formatter.js";
import {
  git,
  KnowledgePublicationGitError,
  type KnowledgePublicationInventory,
} from "./knowledge-publication-git.js";

export const KNOWLEDGE_PUBLICATION_FORMAT_SUBJECT = "docs: format published background knowledge";

export type KnowledgePublicationTip =
  | {
      status: "built";
      tip: string;
      /** True when the knowledge commits were replayed onto the remote base. */
      replayed: boolean;
      /** Paths the publisher's own formatting commit on top of the knowledge commits changed. */
      formattedPathCount: number;
    }
  | { status: "conflict"; conflictPathCount: number };

const touchedPaths = (inventory: KnowledgePublicationInventory) =>
  inventory.knowledge.flatMap((commit) => commit.paths);

async function unformattedAt(
  root: string,
  formatter: KnowledgeOutputFormatter,
  inventory: KnowledgePublicationInventory,
): Promise<string[]> {
  const targets = await revisionRangeFormatTargets({
    root,
    base: inventory.base,
    tip: inventory.head,
    touchedPaths: touchedPaths(inventory),
  });
  return unformattedKnowledgeOutputs({
    formatter,
    directory: root,
    contents: await readRevisionFiles(root, inventory.head, targets),
  });
}

/**
 * Cherry-picks each knowledge commit with its own committer date. The author, message, parent,
 * and tree already match, so identical input always yields identical commit hashes and an
 * unchanged publication never needs a new push.
 */
async function replay(
  worktree: string,
  inventory: KnowledgePublicationInventory,
): Promise<{ status: "replayed" } | { status: "conflict"; conflictPathCount: number }> {
  for (const commit of inventory.knowledge) {
    try {
      await git(
        worktree,
        ["cherry-pick", "--allow-empty", "--keep-redundant-commits", commit.sha],
        "rebuild",
        { ...KNOWLEDGE_OUTPUT_COMMIT_IDENTITY, GIT_COMMITTER_DATE: commit.committerDate },
      );
    } catch (error) {
      const conflicted =
        error instanceof KnowledgePublicationGitError && error.exitCode === 1
          ? await git(worktree, ["diff", "--name-only", "--diff-filter=U", "-z"], "rebuild").catch(
              () => "",
            )
          : null;
      await git(worktree, ["cherry-pick", "--abort"], "rebuild").catch(() => "");
      if (conflicted === null) throw error;
      return {
        status: "conflict",
        conflictPathCount: conflicted.split("\0").filter((path) => path !== "").length,
      };
    }
  }
  return { status: "replayed" };
}

/** Commits the repository formatter's changes as `Lervo Knowledge`, dated like the last input. */
async function commitFormatting(
  worktree: string,
  formatter: KnowledgeOutputFormatter,
  inventory: KnowledgePublicationInventory,
): Promise<number> {
  const targets = await revisionRangeFormatTargets({
    root: worktree,
    base: inventory.base,
    tip: "HEAD",
    touchedPaths: touchedPaths(inventory),
  });
  const changed = [
    ...(
      await formatKnowledgeOutputFiles({ formatter, directory: worktree, paths: targets })
    ).keys(),
  ];
  if (changed.length === 0) return 0;
  const date = inventory.knowledge.at(-1)!.committerDate;
  await git(worktree, ["add", "--", ...changed], "rebuild");
  await git(
    worktree,
    [
      "commit",
      "--quiet",
      "--no-verify",
      "-m",
      KNOWLEDGE_PUBLICATION_FORMAT_SUBJECT,
      "-m",
      // Commit lint limits body lines to 100 characters, so the body wraps.
      `Lervo formatted ${changed.length} path(s) that the published knowledge commits changed\n` +
        "or released, with the repository's own formatter configuration.",
    ],
    "rebuild",
    { ...KNOWLEDGE_OUTPUT_COMMIT_IDENTITY, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  );
  return changed.length;
}

/**
 * The publication tip, always on top of the current remote base and handed to the repository
 * formatter already formatted. When `HEAD` already descends from that base, `base..HEAD` holds
 * only the knowledge commits, and every path they change or release is formatted, the tip is
 * `HEAD` itself, so a merge commit later lets the local branch fast-forward. Otherwise the
 * knowledge commits are replayed onto the base in a temporary worktree, or `HEAD` is checked out
 * there, and one formatting commit follows when needed; developer work never enters the tip. A
 * replay conflict means the outputs were computed against stale source bytes: it reports the
 * conflicting path count and leaves no worktree behind.
 */
export async function buildKnowledgePublicationTip(
  root: string,
  inventory: KnowledgePublicationInventory,
  formatter: KnowledgeOutputFormatter | null,
): Promise<KnowledgePublicationTip> {
  const onBase = await git(
    root,
    ["merge-base", "--is-ancestor", inventory.base, inventory.head],
    "inspect",
  ).then(
    () => true,
    () => false,
  );
  const direct = inventory.otherCount === 0 && onBase;
  if (
    direct &&
    (formatter === null || (await unformattedAt(root, formatter, inventory)).length === 0)
  )
    return { status: "built", tip: inventory.head, replayed: false, formattedPathCount: 0 };
  const directory = await mkdtemp(resolve(tmpdir(), "lervo-knowledge-publication-"));
  const worktree = resolve(directory, "tree");
  try {
    await git(
      root,
      [
        "worktree",
        "add",
        "--quiet",
        "--detach",
        worktree,
        direct ? inventory.head : inventory.base,
      ],
      "rebuild",
    );
    if (!direct) {
      const replayed = await replay(worktree, inventory);
      if (replayed.status === "conflict") return replayed;
    }
    const formattedPathCount =
      formatter === null ? 0 : await commitFormatting(worktree, formatter, inventory);
    return {
      status: "built",
      tip: (await git(worktree, ["rev-parse", "HEAD"], "rebuild")).trim(),
      replayed: !direct,
      formattedPathCount,
    };
  } finally {
    await git(root, ["worktree", "remove", "--force", worktree], "rebuild").catch(() => "");
    await rm(directory, { recursive: true, force: true });
    await git(root, ["worktree", "prune"], "rebuild").catch(() => "");
  }
}

/**
 * The remote publication head when it already carries `tip`'s content: the same commit trees, in
 * order, on the same base. Deterministic replay normally makes it `tip` itself; this also adopts
 * an equivalent head pushed earlier, so unchanged content never restarts its checks.
 */
export async function equivalentPublishedHead(
  root: string,
  base: string,
  tip: string,
  remoteHead: string | null,
): Promise<string | null> {
  if (remoteHead === null || remoteHead === tip) return remoteHead;
  const descends = await git(
    root,
    ["merge-base", "--is-ancestor", base, remoteHead],
    "inspect",
  ).then(
    () => true,
    () => false,
  );
  if (!descends) return null;
  // One `<tree> <parent>` line per commit, oldest first; a merge has a second parent.
  const series = async (head: string) =>
    (await git(root, ["log", "--reverse", "--format=%T %P", `${base}..${head}`], "inspect"))
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => {
        const fields = line.split(" ");
        return fields.length === 2 ? fields[0]! : null;
      });
  const [remoteTrees, tipTrees] = await Promise.all([series(remoteHead), series(tip)]);
  return remoteTrees.length > 0 &&
    remoteTrees.length === tipTrees.length &&
    remoteTrees.every((tree, index) => tree !== null && tree === tipTrees[index])
    ? remoteHead
    : null;
}
