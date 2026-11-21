import { randomUUID } from "node:crypto";
import { chmod, lstat, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { KnowledgePublicationHistoryEntry } from "./knowledge-publication-forge.js";
import { knowledgeStateDirectory } from "./knowledge-publication-state.js";

/**
 * ADR-0603: GitHub is the source of truth for what is published. A local knowledge commit is
 * published when its patch is among the commits a merged pull request of the branch carried, as
 * GitHub's own `refs/pull/<n>/head` shows them; any host derives the same answer from GitHub alone,
 * also for pull requests merged before Lervo wrote records. Each body ends with a record of the
 * head Lervo pushed and the commits it carries, for people and for Lervo's own closure mark; the
 * record never makes a commit published. The local file is only a cache.
 */

const RECORD_START = "<!-- lervo-publication-record";
const RECORD_END = "-->";
const COMMIT = /^[0-9a-f]{40,64}$/u;
const LINE = /^Lervo-Publication-(Head|Commit|Closed): (\S+)$/u;
const CLOSED_REASON = /^[a-z][a-z_]{0,31}$/u;

export interface KnowledgePublicationRecord {
  head: string;
  commits: string[];
  /** Set by Lervo when it closes the pull request itself, so the closure is not a person's decision. */
  closed: string | null;
}

/** The record block that ends a publication pull request body; HTML comments do not render. */
export function renderKnowledgePublicationRecord(record: {
  head: string;
  commits: readonly string[];
}): string {
  return [
    RECORD_START,
    `Lervo-Publication-Head: ${record.head}`,
    ...record.commits.map((sha) => `Lervo-Publication-Commit: ${sha}`),
    RECORD_END,
  ].join("\n");
}

/** The last record block of `body`, or null when there is none or any line is malformed. */
export function parseKnowledgePublicationRecord(body: string): KnowledgePublicationRecord | null {
  const start = body.lastIndexOf(RECORD_START);
  if (start < 0) return null;
  const end = body.indexOf(RECORD_END, start + RECORD_START.length);
  if (end < 0) return null;
  let head: string | null = null;
  let closed: string | null = null;
  const commits: string[] = [];
  for (const line of body.slice(start + RECORD_START.length, end).split(/\r?\n/u)) {
    const text = line.trim();
    if (text === "") continue;
    const [, field, value] = LINE.exec(text) ?? [];
    if (field === "Head" && head === null && COMMIT.test(value!)) head = value!;
    else if (field === "Commit" && COMMIT.test(value!)) commits.push(value!);
    else if (field === "Closed" && closed === null && CLOSED_REASON.test(value!)) closed = value!;
    else return null;
  }
  return head === null || commits.length === 0 ? null : { head, commits, closed };
}

/** `body` with its record marked closed by Lervo; a body without a record stays as it is. */
export function markKnowledgePublicationClosed(body: string, reason: string): string {
  const start = body.lastIndexOf(RECORD_START);
  const end = start < 0 ? -1 : body.indexOf(RECORD_END, start + RECORD_START.length);
  if (end < 0 || parseKnowledgePublicationRecord(body) === null) return body;
  return `${body.slice(0, end)}Lervo-Publication-Closed: ${reason}\n${body.slice(end)}`;
}

export interface KnowledgePublicationDeclined {
  pullRequestNumber: number;
  commits: string[];
}

export interface KnowledgePublicationHistory {
  /** Local commits whose patch a merged pull request carried. */
  published: Set<string>;
  /**
   * Pull requests a person closed without merge, with the local commits only they carried: a
   * decision Lervo never reopens or publishes again. A pull request Lervo closed itself, or one
   * GitHub closed because its branch was deleted, is no decision.
   */
  declined: KnowledgePublicationDeclined[];
  /** The newest merged pull request and its merge commit, null until the forge reports one. */
  lastMerged: { pullRequestNumber: number; mergeCommit: string | null } | null;
}

/** How a closed, unmerged pull request was closed. */
export type KnowledgePublicationClosure = "person" | "branch_deleted";

/**
 * Derives what is published and declined from the patches closed pull requests carried and the
 * patches of the local candidate commits. A local commit is published when a merged pull request
 * carried its patch and the commit was not built on that merge: `after` holds `sha:number` for
 * each local commit whose parent already contains the pull request's merge commit, so an identical
 * change Lervo regenerates after a person reverted the merge is new work, and is published again.
 * No clock decides it.
 */
export function deriveKnowledgePublicationHistory(input: {
  entries: readonly KnowledgePublicationHistoryEntry[];
  /** Patch ids each scanned pull request carried. */
  carried: ReadonlyMap<number, readonly string[]>;
  /** Patch id of each local candidate commit. */
  local: ReadonlyMap<string, { patch: string }>;
  /** `sha:number` of each local commit built on pull request `number`'s merge commit. */
  after: ReadonlySet<string>;
  /** How each closed, unmerged pull request was closed, where it was read. */
  closures: ReadonlyMap<number, KnowledgePublicationClosure>;
  /** Commits a closed pull request's record names, for one whose head GitHub does not serve. */
  recorded?: ReadonlyMap<number, readonly string[]>;
}): KnowledgePublicationHistory {
  /** The merged pull requests that carried each patch. */
  const carriers = new Map<string, number[]>();
  let lastMerged: KnowledgePublicationHistory["lastMerged"] = null;
  for (const entry of input.entries) {
    if (!entry.merged) continue;
    if (lastMerged === null || entry.number > lastMerged.pullRequestNumber)
      lastMerged = { pullRequestNumber: entry.number, mergeCommit: entry.mergeCommit };
    for (const patch of input.carried.get(entry.number) ?? [])
      carriers.set(patch, [...(carriers.get(patch) ?? []), entry.number]);
  }
  const published = new Set(
    [...input.local]
      .filter(([sha, local]) =>
        (carriers.get(local.patch) ?? []).some((number) => !input.after.has(`${sha}:${number}`)),
      )
      .map(([sha]) => sha),
  );
  const declined = input.entries
    .filter(
      (entry) =>
        !entry.merged && !closedByLervo(entry) && input.closures.get(entry.number) === "person",
    )
    .map((entry) => {
      const patches = new Set(input.carried.get(entry.number) ?? []);
      // ADR-0607: a closed head GitHub no longer serves is still a person's decline; its record
      // names what it carried, which can only hold commits back, never publish them.
      const named = new Set(input.recorded?.get(entry.number) ?? []);
      return {
        pullRequestNumber: entry.number,
        commits: [...input.local]
          .filter(
            ([sha, local]) => (patches.has(local.patch) || named.has(sha)) && !published.has(sha),
          )
          .map(([sha]) => sha),
      };
    })
    .filter((item) => item.commits.length > 0)
    .sort((left, right) => left.pullRequestNumber - right.pullRequestNumber);
  return { published, declined, lastMerged };
}

/** Whether Lervo marked the pull request's record closed by itself. */
export function closedByLervo(entry: KnowledgePublicationHistoryEntry): boolean {
  return (
    entry.closedByLervo ?? (parseKnowledgePublicationRecord(entry.record)?.closed ?? null) !== null
  );
}

/** Private, rebuildable cache of the derived history for this checkout. */
export const KNOWLEDGE_PUBLICATION_HISTORY_PATH =
  ".lervo/state/knowledge/knowledge-publication-history.json";

/**
 * The cache has two parts with their own keys. `history` belongs to the repository: the closed
 * pull requests read so far, through the forge's latest `updatedAt`, and the patch ids of each
 * settled one, which never change; a new host key keeps it, and only newer changes are read
 * again. `local` belongs to this host's checkout: the derived set as of one local base and head,
 * keeping only commits still in `base..head`, so it needs no cap.
 */
export interface KnowledgePublicationHistoryCache {
  schemaVersion: 2;
  repository: string;
  history: {
    through: string | null;
    pullRequests: KnowledgePublicationHistoryEntry[];
    pullPatches: Record<string, string[]>;
  };
  local: {
    hostHash: string;
    base: string;
    head: string;
    published: string[];
    declined: KnowledgePublicationDeclined[];
    lastMerged: KnowledgePublicationHistory["lastMerged"];
  } | null;
}

const MAXIMUM_CACHE_BYTES = 32 * 1024 * 1024;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/u;

function commits(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((sha) => typeof sha === "string" && COMMIT.test(sha));
}

function validEntry(item: Partial<KnowledgePublicationHistoryEntry> | null): boolean {
  return (
    item !== null &&
    typeof item === "object" &&
    Number.isSafeInteger(item.number) &&
    typeof item.merged === "boolean" &&
    typeof item.headSha === "string" &&
    COMMIT.test(item.headSha) &&
    (item.mergeCommit === null ||
      (typeof item.mergeCommit === "string" && COMMIT.test(item.mergeCommit))) &&
    (item.mergedAt === null || (typeof item.mergedAt === "string" && ISO.test(item.mergedAt))) &&
    typeof item.updatedAt === "string" &&
    ISO.test(item.updatedAt) &&
    typeof item.record === "string" &&
    (item.closedByLervo === undefined || typeof item.closedByLervo === "boolean")
  );
}

function validLocal(local: KnowledgePublicationHistoryCache["local"]): boolean {
  if (local === null) return true;
  const merged = local.lastMerged;
  return (
    typeof local === "object" &&
    typeof local.hostHash === "string" &&
    typeof local.base === "string" &&
    COMMIT.test(local.base) &&
    typeof local.head === "string" &&
    COMMIT.test(local.head) &&
    commits(local.published) &&
    Array.isArray(local.declined) &&
    local.declined.every(
      (item) => Number.isSafeInteger(item?.pullRequestNumber) && commits(item.commits),
    ) &&
    (merged === null ||
      (Number.isSafeInteger(merged?.pullRequestNumber) &&
        (merged.mergeCommit === null ||
          (typeof merged.mergeCommit === "string" && COMMIT.test(merged.mergeCommit)))))
  );
}

/** The cache when it is valid; anything else reads as null, and the next GitHub read rebuilds it. */
export async function readKnowledgePublicationHistoryCache(
  root: string,
): Promise<KnowledgePublicationHistoryCache | null> {
  try {
    const path = resolve(root, KNOWLEDGE_PUBLICATION_HISTORY_PATH);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > MAXIMUM_CACHE_BYTES) return null;
    const value = JSON.parse(await readFile(path, "utf8")) as KnowledgePublicationHistoryCache;
    const history = value?.history;
    return value?.schemaVersion === 2 &&
      typeof value.repository === "string" &&
      history !== null &&
      typeof history === "object" &&
      (history.through === null ||
        (typeof history.through === "string" && ISO.test(history.through))) &&
      Array.isArray(history.pullRequests) &&
      history.pullRequests.every(validEntry) &&
      history.pullPatches !== null &&
      typeof history.pullPatches === "object" &&
      Object.entries(history.pullPatches).every(
        ([number, patches]) =>
          /^[1-9][0-9]{0,9}:[0-9a-f]{40,64}$/u.test(number) &&
          Array.isArray(patches) &&
          patches.every((patch) => typeof patch === "string" && /^[0-9a-f]{40,64}$/u.test(patch)),
      ) &&
      validLocal(value.local)
      ? value
      : null;
  } catch {
    return null;
  }
}

/** The write budget; the read limit above leaves room for one more cycle's growth. */
const CACHE_WRITE_BUDGET_BYTES = 16 * 1024 * 1024;

/**
 * Writes the cache within its budget. Past it, the oldest pull requests' patch ids go first, since
 * they can be fetched again; if the history still does not fit, it is dropped and the next read
 * is a full one. Returns whether the history had to be dropped, which the caller reports.
 */
export async function writeKnowledgePublicationHistoryCache(
  root: string,
  cache: KnowledgePublicationHistoryCache,
): Promise<{ historyDropped: boolean }> {
  await knowledgeStateDirectory(root);
  let bounded = cache;
  let text = JSON.stringify(bounded);
  let historyDropped = false;
  if (Buffer.byteLength(text) > CACHE_WRITE_BUDGET_BYTES) {
    const keys = Object.keys(cache.history.pullPatches).sort(
      (left, right) => Number(left.split(":")[0]) - Number(right.split(":")[0]),
    );
    const pullPatches = { ...cache.history.pullPatches };
    let size = Buffer.byteLength(text);
    for (const key of keys) {
      if (size <= CACHE_WRITE_BUDGET_BYTES) break;
      size -= Buffer.byteLength(JSON.stringify({ [key]: pullPatches[key] })) - 2;
      delete pullPatches[key];
    }
    bounded = { ...cache, history: { ...cache.history, pullPatches } };
    text = JSON.stringify(bounded);
    if (Buffer.byteLength(text) > CACHE_WRITE_BUDGET_BYTES) {
      bounded = { ...cache, history: { through: null, pullRequests: [], pullPatches: {} } };
      text = JSON.stringify(bounded);
      historyDropped = true;
    }
  }
  const target = resolve(root, KNOWLEDGE_PUBLICATION_HISTORY_PATH);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${text}\n`, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return { historyDropped };
}
