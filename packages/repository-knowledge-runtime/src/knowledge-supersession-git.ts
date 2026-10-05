import { spawn } from "node:child_process";

import { KNOWLEDGE_OUTPUT_COMMIT_AUTHOR } from "./knowledge-output-commit.js";
import { git } from "./knowledge-publication-git.js";

/** At most this many tip commits are inspected; a ledger never holds more superseded commits. */
const MAXIMUM_TIP_COMMITS = 64;

/** Runs Git with `input` on stdin; a nonzero exit rejects without exposing stderr. */
function gitWithInput(root: string, args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", root, ...args], {
      stdio: ["pipe", "pipe", "ignore"],
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    const output: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => output.push(chunk));
    child.stdin.on("error", () => undefined);
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(Buffer.concat(output).toString("utf8"));
      else reject(new Error(`git ${args[0]} exited with ${code ?? "a signal"}`));
    });
    child.stdin.end(input);
  });
}

/** `git patch-id --stable` per commit; commits without a diff have no entry. */
export async function knowledgeCommitPatchIds(
  root: string,
  commits: readonly string[],
): Promise<Map<string, string>> {
  if (commits.length === 0) return new Map();
  const patches = await gitWithInput(
    root,
    ["diff-tree", "--stdin", "-p", "-r", "--root", "--no-color", "--no-ext-diff"],
    `${commits.join("\n")}\n`,
  );
  const ids = await gitWithInput(root, ["patch-id", "--stable"], patches);
  const result = new Map<string, string>();
  for (const line of ids.split("\n")) {
    const [patchId, commit] = line.trim().split(" ");
    if (patchId !== undefined && commit !== undefined) result.set(commit, patchId);
  }
  return result;
}

export interface TipKnowledgeCommit {
  commit: string;
  parent: string;
}

/**
 * The run of non-merge `Lervo Knowledge` commits at the tip of `HEAD`, newest first. The run
 * ends at the first merge, root, or commit with another author or committer.
 */
export async function tipKnowledgeCommits(root: string): Promise<TipKnowledgeCommit[]> {
  const log = await git(
    root,
    [
      "log",
      "--first-parent",
      `--max-count=${MAXIMUM_TIP_COMMITS}`,
      "--format=%H%x00%P%x00%ae%x00%ce",
      "HEAD",
    ],
    "inspect",
  );
  const run: TipKnowledgeCommit[] = [];
  for (const line of log.split("\n")) {
    const [commit, parents, author, committer] = line.split("\0");
    if (commit === undefined || commit === "") continue;
    const parentList = (parents ?? "").trim().split(" ").filter(Boolean);
    if (
      parentList.length !== 1 ||
      author !== KNOWLEDGE_OUTPUT_COMMIT_AUTHOR.email ||
      committer !== KNOWLEDGE_OUTPUT_COMMIT_AUTHOR.email
    )
      break;
    run.push({ commit, parent: parentList[0]! });
  }
  return run;
}

export async function isAncestorCommit(
  root: string,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  return git(root, ["merge-base", "--is-ancestor", ancestor, descendant], "inspect").then(
    () => true,
    () => false,
  );
}

/** The given commits that exist here and are reachable from `HEAD`, in input order. */
export async function commitsReachableFromHead(
  root: string,
  commits: readonly string[],
): Promise<string[]> {
  if (commits.length === 0) return [];
  const present = new Set(
    (
      await gitWithInput(
        root,
        ["rev-list", "--ignore-missing", "--no-walk", "--stdin"],
        `${commits.join("\n")}\n`,
      )
    )
      .split("\n")
      .filter(Boolean),
  );
  if (present.size === 0) return [];
  const notInHead = new Set(
    (await gitWithInput(root, ["rev-list", "--stdin"], `${[...present].join("\n")}\n^HEAD\n`))
      .split("\n")
      .filter(Boolean),
  );
  return commits.filter((commit) => present.has(commit) && !notInHead.has(commit));
}
