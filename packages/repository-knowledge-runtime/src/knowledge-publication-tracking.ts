import { createHash, randomUUID } from "node:crypto";
import { chmod, lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { KNOWLEDGE_OUTPUT_COMMIT_AUTHOR } from "./knowledge-output-commit.js";
import { git } from "./knowledge-publication-git.js";
import type { KnowledgePublicationHistory } from "./knowledge-publication-history.js";
import {
  knowledgeStateDirectory,
  type KnowledgePublicationState,
} from "./knowledge-publication-state.js";

const split = (output: string) => output.split("\0").filter((path) => path !== "");

/**
 * The first commit before what `mergeCommit` landed: its first parent for a merge commit or a
 * squash, and for a rebase the parent of the run of `Lervo Knowledge` commits GitHub replayed
 * together, which share the merge commit's committer time.
 */
async function landedFrom(root: string, mergeCommit: string): Promise<string | null> {
  const log = await git(
    root,
    ["log", "--first-parent", "-n", "512", "--format=%H%x00%P%x00%ae%x00%ct", mergeCommit],
    "inspect",
  );
  const commits = log
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [sha, parents, author, time] = line.split("\0");
      return { sha: sha!, parents: parents!.split(" ").filter(Boolean), author, time };
    });
  const first = commits[0];
  if (first === undefined) return null;
  if (first.parents.length !== 1) return first.parents[0] ?? null;
  let index = 0;
  while (
    commits[index + 1] !== undefined &&
    commits[index]!.author === KNOWLEDGE_OUTPUT_COMMIT_AUTHOR.email &&
    commits[index + 1]!.author === KNOWLEDGE_OUTPUT_COMMIT_AUTHOR.email &&
    commits[index + 1]!.parents.length === 1 &&
    commits[index + 1]!.time === first.time
  )
    index++;
  return commits[index]!.parents[0] ?? null;
}

/**
 * ADR-0603: the paths the newest merged publication landed whose bytes on the base now differ
 * from what its merge commit landed, such as after a revert or a person's edit of a Lervo output.
 * It compares with the merge commit itself, so a squash, a rebase, or the publisher's own
 * formatting commit is never a change, and edits to other paths are ignored. Null means no such
 * path; undefined means it cannot be observed yet, such as before the merge commit is known.
 */
export async function observeBaseChange(
  root: string,
  base: string,
  lastMerged: KnowledgePublicationHistory["lastMerged"],
): Promise<KnowledgePublicationState["baseChanged"] | null | undefined> {
  const mergeCommit = lastMerged?.mergeCommit ?? null;
  if (lastMerged === null || mergeCommit === null) return lastMerged === null ? null : undefined;
  const reachable = await git(root, ["merge-base", "--is-ancestor", mergeCommit, base], "inspect")
    .then(() => true)
    .catch(() => false);
  if (!reachable) return undefined;
  const from = await landedFrom(root, mergeCommit);
  if (from === null) return undefined;
  const paths = split(
    await git(root, ["diff", "--name-only", "-z", "--no-renames", from, mergeCommit], "inspect"),
  );
  if (paths.length === 0) return null;
  const changed = split(
    await git(
      root,
      ["diff", "--name-only", "-z", "--no-renames", mergeCommit, base, "--", ...paths],
      "inspect",
    ),
  ).sort();
  if (changed.length === 0) return null;
  // The key names the base's current bytes, so an acknowledgement ends when they change again.
  const blobs = await git(root, ["ls-tree", "-z", base, "--", ...changed], "inspect");
  const hash = createHash("sha256").update(`${mergeCommit}\0${changed.join("\0")}\0${blobs}`);
  return {
    pullRequestNumber: lastMerged.pullRequestNumber,
    mergeCommit,
    paths: changed.length,
    key: `sha256:${hash.digest("hex")}`,
  };
}

/** The attention the owner acknowledged; only `lervo knowledge convergence owner acknowledge` writes it. */
export const KNOWLEDGE_PUBLICATION_ACKNOWLEDGED_PATH =
  ".lervo/state/knowledge/knowledge-publication-acknowledged.json";

export interface KnowledgePublicationAcknowledged {
  schemaVersion: 1;
  /** The acknowledged base-change key; a new change of the same paths has a new key. */
  baseChange: string | null;
  /** Closed pull requests whose decision was acknowledged. */
  declined: number[];
}

export async function readKnowledgePublicationAcknowledged(
  root: string,
): Promise<KnowledgePublicationAcknowledged | null> {
  try {
    const path = resolve(root, KNOWLEDGE_PUBLICATION_ACKNOWLEDGED_PATH);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > 1024 * 1024) return null;
    const value = JSON.parse(await readFile(path, "utf8")) as KnowledgePublicationAcknowledged;
    return value?.schemaVersion === 1 &&
      (value.baseChange === null ||
        (typeof value.baseChange === "string" &&
          /^sha256:[0-9a-f]{64}$/u.test(value.baseChange))) &&
      Array.isArray(value.declined) &&
      value.declined.every((number) => Number.isSafeInteger(number))
      ? value
      : null;
  } catch {
    return null;
  }
}

/**
 * ADR-0603: acknowledges the publication attention that is an owner's decision: the current base
 * change and the pull requests closed without merge. Lervo still never publishes those commits;
 * the attention ends until the base's bytes change again or another pull request is closed.
 */
export async function acknowledgeKnowledgePublicationAttention(
  root: string,
  state: KnowledgePublicationState | null,
): Promise<KnowledgePublicationAcknowledged> {
  const previous = await readKnowledgePublicationAcknowledged(root);
  const declined = (state?.declined ?? []).map((item) => item.pullRequestNumber);
  const acknowledged: KnowledgePublicationAcknowledged = {
    schemaVersion: 1,
    baseChange: state?.baseChanged?.key ?? previous?.baseChange ?? null,
    // Only closed pull requests that still hold back commits stay, so the list stays bounded.
    declined: [...new Set(declined)].sort((left, right) => left - right),
  };
  const directory = await knowledgeStateDirectory(root);
  const temporary = resolve(directory, `.knowledge-publication-acknowledged-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(acknowledged)}\n`, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, resolve(root, KNOWLEDGE_PUBLICATION_ACKNOWLEDGED_PATH));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return acknowledged;
}
