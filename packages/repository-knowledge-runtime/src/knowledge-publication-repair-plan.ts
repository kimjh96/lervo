import {
  documentNormalizationRecordsForSources,
  observeToolGeneratedDocuments,
} from "@lervo/repository-knowledge";

import { KNOWLEDGE_OUTPUT_COMMIT_AUTHOR } from "./knowledge-output-commit.js";
import { git, type KnowledgePublicationCommit } from "./knowledge-publication-git.js";
import {
  freshnessCommitCandidate,
  isKnowledgePublicationRepairCommit,
  knowledgePublicationViolations,
  type KnowledgePublicationScope,
} from "./knowledge-publication-scope.js";

/** Recent Lervo commits whose paths are checked for tool ownership. */
const RECENT_KNOWLEDGE_COMMITS = 256;
/** A path's newest commits read to find where Lervo's run of changes began. */
const PATH_HISTORY = 64;
const MAXIMUM_TARGETS = 256;

export type KnowledgePublicationRepairReason =
  "tool_generated" | "outside_scope" | "normalization_record" | "normalization_output";

export type KnowledgePublicationRepairBlocker =
  "developer_change" | "reviewed_freshness" | "uncommitted_change" | "history_unavailable";

export interface KnowledgePublicationRepairTarget {
  path: string;
  reason: KnowledgePublicationRepairReason;
  /** The commit whose content of `path` is restored; the path is deleted when absent there. */
  restoreFrom: string;
  /** Lervo commits whose change of `path` the restore undoes, newest first. */
  undoes: string[];
}

export interface KnowledgePublicationRepairPlan {
  targets: KnowledgePublicationRepairTarget[];
  blocked: {
    path: string;
    reason: KnowledgePublicationRepairReason;
    blocker: KnowledgePublicationRepairBlocker;
  }[];
}

export interface PathHistoryCommit {
  sha: string;
  parents: string[];
  authorEmail: string;
  committerEmail: string;
  body: string;
}

/**
 * Pure: where a path's content is restored from. Lervo's run is the newest commits that are all
 * non-merge `Lervo Knowledge` commits; the restore point is the parent of its oldest commit, so
 * nothing a person or tool committed afterwards is undone. A repair commit at the tip means the
 * path is already restored. For an out-of-scope path only unpublished changes are undone: every
 * commit after `base` must be in the run, and `base` is the restore point.
 */
export function knowledgePublicationRestorePoint(input: {
  history: readonly PathHistoryCommit[];
  complete: boolean;
  reason: KnowledgePublicationRepairReason;
  base: string | null;
  unpublished: ReadonlySet<string> | null;
}):
  | { status: "restore"; restoreFrom: string; undoes: string[] }
  | { status: "current" }
  | { status: "blocked"; blocker: KnowledgePublicationRepairBlocker } {
  const run: PathHistoryCommit[] = [];
  let boundary = false;
  for (const commit of input.history) {
    const lervo =
      commit.parents.length === 1 &&
      commit.authorEmail === KNOWLEDGE_OUTPUT_COMMIT_AUTHOR.email &&
      commit.committerEmail === KNOWLEDGE_OUTPUT_COMMIT_AUTHOR.email;
    if (!lervo || isKnowledgePublicationRepairCommit(commit)) {
      boundary = true;
      break;
    }
    if (input.reason === "outside_scope" && freshnessCommitCandidate(commit) !== null)
      return { status: "blocked", blocker: "reviewed_freshness" };
    run.push(commit);
  }
  // A newer commit by a person or a tool keeps the path as it is; publication still refuses an
  // unpublished Lervo change below it, so that case is reported as blocked.
  if (run.length === 0)
    return input.history[0] !== undefined &&
      !isKnowledgePublicationRepairCommit(input.history[0]) &&
      (input.unpublished?.size ?? 0) > 0
      ? { status: "blocked", blocker: "developer_change" }
      : { status: "current" };
  if (input.reason === "outside_scope") {
    if (input.base === null || input.unpublished === null)
      return { status: "blocked", blocker: "history_unavailable" };
    const unpublished = input.unpublished;
    const runShas = new Set(run.map((commit) => commit.sha));
    if ([...unpublished].some((sha) => !runShas.has(sha)))
      return { status: "blocked", blocker: "developer_change" };
    return {
      status: "restore",
      restoreFrom: input.base,
      undoes: run.filter((commit) => unpublished.has(commit.sha)).map((commit) => commit.sha),
    };
  }
  if (!boundary && !input.complete) return { status: "blocked", blocker: "history_unavailable" };
  const parent = run.at(-1)!.parents[0];
  if (parent === undefined) return { status: "blocked", blocker: "history_unavailable" };
  return { status: "restore", restoreFrom: parent, undoes: run.map((commit) => commit.sha) };
}

async function pathHistory(
  root: string,
  path: string,
): Promise<{ history: PathHistoryCommit[]; complete: boolean }> {
  const output = await git(
    root,
    [
      "log",
      `--max-count=${PATH_HISTORY}`,
      "--format=%H%x00%P%x00%ae%x00%ce%x00%B%x1e",
      "HEAD",
      "--",
      `:(literal)${path}`,
    ],
    "repair",
  );
  const history = output
    .split("\x1e")
    .map((record) => record.replace(/^\n/u, ""))
    .filter((record) => record.trim() !== "")
    .map((record) => {
      const [sha, parents, authorEmail, committerEmail, body] = record.split("\0");
      return {
        sha: sha!.trim(),
        parents: (parents ?? "")
          .trim()
          .split(" ")
          .filter((parent) => parent !== ""),
        authorEmail: authorEmail ?? "",
        committerEmail: committerEmail ?? "",
        body: body ?? "",
      };
    });
  return { history, complete: history.length < PATH_HISTORY };
}

async function unpublishedCommitsTouching(
  root: string,
  base: string,
  path: string,
): Promise<Set<string>> {
  const output = await git(
    root,
    ["rev-list", `${base}..HEAD`, "--", `:(literal)${path}`],
    "repair",
  );
  return new Set(output.split("\n").filter((line) => line.trim() !== ""));
}

/** Paths that recent `Lervo Knowledge` commits changed, newest commit first. */
async function recentKnowledgePaths(root: string): Promise<string[]> {
  const output = await git(
    root,
    [
      "-c",
      "core.quotePath=false",
      "log",
      "--no-merges",
      `--max-count=${RECENT_KNOWLEDGE_COMMITS}`,
      `--author=${KNOWLEDGE_OUTPUT_COMMIT_AUTHOR.email}`,
      "--format=%x1e%ce",
      "--name-only",
      "HEAD",
    ],
    "repair",
  );
  const paths = new Set<string>();
  for (const record of output.split("\x1e")) {
    const [committer, ...files] = record.split("\n");
    if (committer?.trim() !== KNOWLEDGE_OUTPUT_COMMIT_AUTHOR.email) continue;
    for (const file of files) if (file.trim() !== "") paths.add(file);
  }
  return [...paths];
}

async function dirtyPaths(root: string, paths: readonly string[]): Promise<Set<string>> {
  if (paths.length === 0) return new Set();
  const output = await git(
    root,
    [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ...paths.map((path) => `:(literal)${path}`),
    ],
    "repair",
  );
  const dirty = new Set<string>();
  const entries = output.split("\0");
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    if (entry.length < 4) continue;
    dirty.add(entry.slice(3));
    // A rename or copy carries its source path in the next field.
    if (entry[0] === "R" || entry[0] === "C") dirty.add(entries[++index] ?? "");
  }
  return dirty;
}

/**
 * ADR-0473 repair plan. Candidates are tool-generated paths that recent Lervo commits changed and
 * unpublished paths outside the knowledge write scope; the normalization records and extra
 * outputs of a restored tool-generated document follow it. Every target is restored only to
 * content that predates Lervo's own run of changes, never past a person's or a tool's commit.
 */
export async function planKnowledgePublicationRepair(input: {
  repositoryRoot: string;
  base: string | null;
  unpublished: readonly KnowledgePublicationCommit[];
  scope: KnowledgePublicationScope;
}): Promise<KnowledgePublicationRepairPlan> {
  const root = input.repositoryRoot;
  const recent = await recentKnowledgePaths(root);
  const toolGenerated = new Set(
    (
      await observeToolGeneratedDocuments({
        repositoryRoot: root,
        paths: [...new Set([...recent, ...input.unpublished.flatMap((commit) => commit.paths)])],
      })
    ).keys(),
  );
  const outside = await knowledgePublicationViolations({
    repositoryRoot: root,
    commits: input.unpublished,
    scope: input.scope,
    toolGenerated: new Set(),
  });
  const candidates = new Map<string, KnowledgePublicationRepairReason>();
  for (const path of toolGenerated) candidates.set(path, "tool_generated");
  for (const violation of outside)
    if (!candidates.has(violation.path)) candidates.set(violation.path, "outside_scope");

  const plan: KnowledgePublicationRepairPlan = { targets: [], blocked: [] };
  const decide = async (path: string, reason: KnowledgePublicationRepairReason) => {
    if (plan.targets.length >= MAXIMUM_TARGETS) return null;
    const { history, complete } = await pathHistory(root, path);
    const decision = knowledgePublicationRestorePoint({
      history,
      complete,
      reason,
      base: input.base,
      unpublished:
        input.base === null ? null : await unpublishedCommitsTouching(root, input.base, path),
    });
    if (decision.status === "blocked")
      plan.blocked.push({ path, reason, blocker: decision.blocker });
    if (decision.status !== "restore") return null;
    const target = { path, reason, restoreFrom: decision.restoreFrom, undoes: decision.undoes };
    plan.targets.push(target);
    return target;
  };
  const restoredDocuments = new Set<string>();
  for (const [path, reason] of [...candidates].sort(([left], [right]) => left.localeCompare(right)))
    if ((await decide(path, reason)) !== null && reason === "tool_generated")
      restoredDocuments.add(path);
  const records = await documentNormalizationRecordsForSources(root, restoredDocuments).catch(
    () => [],
  );
  const planned = new Set(plan.targets.map((target) => target.path));
  for (const record of records) {
    const followers: [string, KnowledgePublicationRepairReason][] = [
      [record.recordPath, "normalization_record"],
      ...record.outputPaths
        .filter((output) => output !== record.sourcePath)
        .map((output): [string, KnowledgePublicationRepairReason] => [
          output,
          "normalization_output",
        ]),
    ];
    for (const [path, reason] of followers) {
      if (planned.has(path)) continue;
      planned.add(path);
      await decide(path, reason);
    }
  }
  const dirty = await dirtyPaths(
    root,
    plan.targets.map((target) => target.path),
  );
  if (dirty.size > 0) {
    for (const target of plan.targets.filter((item) => dirty.has(item.path)))
      plan.blocked.push({
        path: target.path,
        reason: target.reason,
        blocker: "uncommitted_change",
      });
    plan.targets = plan.targets.filter((target) => !dirty.has(target.path));
  }
  return plan;
}
