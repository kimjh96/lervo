import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { listAssignments, listWorkspaces } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";

import { ConversationChangeLoop } from "./conversation-change-loop.js";

const run = promisify(execFile);
const ABSENT = "0".repeat(40);
const RESULT_REF_PREFIX = "refs/heads/lervo/results/";

export interface PublishedSupervisionResult {
  assignmentId: string;
  ref: string;
  commit: string;
}

async function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<string> {
  const { stdout } = await run("git", args, {
    cwd,
    env: { ...process.env, ...env },
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
}

async function refExists(cwd: string, ref: string): Promise<boolean> {
  try {
    await git(cwd, ["rev-parse", "--verify", "--quiet", ref]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Commits one accepted worker checkout onto its own result branch. The commit uses a private
 * index, so the checkout is never modified, and fixed dates make a rerun produce the same commit.
 * Git-ignored files stay out, and an unchanged checkout publishes nothing.
 */
export async function publishSupervisionResultWorkspace(input: {
  path: string;
  assignmentId: string;
  resultContentHash: string | null;
  completedAt: string;
}): Promise<PublishedSupervisionResult | null> {
  const ref = `${RESULT_REF_PREFIX}${input.assignmentId}`;
  if (await refExists(input.path, ref)) return null;
  const head = await git(input.path, ["rev-parse", "HEAD"]);
  const indexDirectory = await mkdtemp(join(tmpdir(), "lervo-result-index-"));
  try {
    const env = { GIT_INDEX_FILE: join(indexDirectory, "index") };
    await git(input.path, ["read-tree", head], env);
    await git(input.path, ["add", "--all", "--", "."], env);
    const tree = await git(input.path, ["write-tree"], env);
    if (tree === (await git(input.path, ["rev-parse", `${head}^{tree}`]))) return null;
    const identity = {
      GIT_AUTHOR_NAME: "Lervo supervision",
      GIT_AUTHOR_EMAIL: "supervision@lervo.invalid",
      GIT_AUTHOR_DATE: input.completedAt,
      GIT_COMMITTER_NAME: "Lervo supervision",
      GIT_COMMITTER_EMAIL: "supervision@lervo.invalid",
      GIT_COMMITTER_DATE: input.completedAt,
    };
    const message = [
      `Accepted supervision result ${input.assignmentId}`,
      "",
      input.resultContentHash === null
        ? "No result artifact was recorded."
        : `Result artifact: ${input.resultContentHash}`,
    ].join("\n");
    const commit = await git(
      input.path,
      ["commit-tree", tree, "-p", head, "-m", message],
      identity,
    );
    // Create-only: an existing branch is never moved.
    await git(input.path, ["update-ref", ref, commit, ABSENT]);
    return { assignmentId: input.assignmentId, ref, commit };
  } finally {
    await rm(indexDirectory, { recursive: true, force: true });
  }
}

/**
 * `<assignment>:<artifact>` pairs the owner accepted. A completed assignment only means the worker
 * returned a result; the owner may still reject it, so publication needs an accepted review that
 * names that exact result artifact.
 */
export function acceptedResultKeys(
  events: readonly { type: string; payload: unknown }[],
): Set<string> {
  const accepted = new Set<string>();
  for (const event of events) {
    if (event.type !== "work.supervision.review.recorded") continue;
    const payload = event.payload as {
      verdict?: unknown;
      assignmentIds?: unknown;
      artifactHashes?: unknown;
    };
    if (
      payload.verdict !== "accepted" ||
      !Array.isArray(payload.assignmentIds) ||
      !Array.isArray(payload.artifactHashes)
    )
      continue;
    for (const assignmentId of payload.assignmentIds)
      for (const artifact of payload.artifactHashes)
        accepted.add(`${String(assignmentId)}:${String(artifact)}`);
  }
  return accepted;
}

async function acceptedResults(repositoryRoot: string): Promise<ReadonlySet<string>> {
  const storage = await openProjectStorage(repositoryRoot);
  try {
    const accepted = new Set<string>();
    let afterSeq = 0;
    while (true) {
      const events = storage.events.list({ afterSeq, limit: 1000 });
      for (const key of acceptedResultKeys(events)) accepted.add(key);
      afterSeq = events.at(-1)?.seq ?? afterSeq;
      if (events.length < 1000) break;
    }
    return accepted;
  } finally {
    await storage.close();
  }
}

/**
 * Publishes every owner-accepted worker assignment's checkout as `lervo/results/<assignment>`. The
 * user's checked-out branch and working tree are never touched: landing a result is a merge by a
 * later observed turn, which also queues its background knowledge review (ADR-0433).
 */
export async function publishCompletedSupervisionResults(input: {
  repositoryRoot: string;
  parentDirectory: string;
  acceptedResults?: (repositoryRoot: string) => Promise<ReadonlySet<string>>;
}): Promise<PublishedSupervisionResult[]> {
  const assignments = new Map(
    (await listAssignments(input.repositoryRoot)).map((item) => [item.assignmentId, item]),
  );
  const published: PublishedSupervisionResult[] = [];
  let accepted: ReadonlySet<string> | null = null;
  for (const workspace of await listWorkspaces(input.repositoryRoot)) {
    const assignment = assignments.get(workspace.assignmentId);
    const artifact = assignment?.resultArtifacts[0]?.contentHash;
    if (
      workspace.executionKind !== "worker" ||
      workspace.state === "removed" ||
      assignment?.status !== "completed" ||
      artifact === undefined
    )
      continue;
    accepted ??= await (input.acceptedResults ?? acceptedResults)(input.repositoryRoot);
    if (!accepted.has(`${assignment.assignmentId}:${artifact}`)) continue;
    const path = resolve(input.parentDirectory, workspace.workspaceId);
    if (!(await stat(path).catch(() => null))?.isDirectory()) continue;
    const result = await publishSupervisionResultWorkspace({
      path,
      assignmentId: workspace.assignmentId,
      resultContentHash: artifact,
      completedAt: assignment.updatedAt,
    });
    if (result !== null) published.push(result);
  }
  return published;
}

export function startSupervisionResultBranchLoop(input: {
  repositoryRoot: string;
  parentDirectory: string;
  subscribe(notify: () => void): () => void;
  onPublished(result: PublishedSupervisionResult): void;
  onFailure(error: unknown): void;
}): () => Promise<void> {
  const loop = new ConversationChangeLoop({
    intervalMs: 60_000,
    continueOnFailure: true,
    failureRetryMs: () => 60_000,
    subscribe: input.subscribe,
    onFailure: input.onFailure,
    runCycle: async () => {
      for (const result of await publishCompletedSupervisionResults(input))
        input.onPublished(result);
    },
  });
  loop.start();
  return () => loop.stop();
}
