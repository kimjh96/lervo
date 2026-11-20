import { execFileSync } from "node:child_process";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { canonicalJson, recordSynchronousGitProcess, sha256 } from "@lervo/repository-knowledge";
import { defaultRepositoryHoldPath } from "@lervo/repository-registry";
import type { OutboxStore } from "@lervo/storage-contract";

import { observeConvergenceQueue } from "./convergence-queue-observation.js";
import { nextUtcDayAt, observePracticeSchedule } from "./practice-schedule.js";
import { PRACTICE_ROOT } from "./practice-store.js";
import { repositoryHeadIdentity } from "./repository-head-identity.js";
import { convergenceSourceCaptureSettings } from "./source-capture-settings.js";

const MAXIMUM_OBSERVED_PATHS = 20_000;
const KNOWLEDGE_STATE = ".lervo/state/knowledge";

export interface ConvergenceSourceFingerprint {
  /** Repository, policy, delegation, candidate, event-head and outbox observation digest. */
  fingerprint: string;
  /** The repository-only part, stable while other processes append unrelated events. */
  sourceDigest: string;
  /**
   * Earliest moment a pending or lease-expired knowledge delivery becomes claimable, or a local
   * time-based stage falls due, whichever comes first.
   */
  earliestAvailableAt: number | null;
  /**
   * ADR-0595: the earliest future moment a local time-based stage (practice, the daily skill
   * usage window) falls due. Every host runs these, so a non-owner wakes for them too.
   */
  localWakeAt?: number | null;
}

/** The earlier of two optional moments. */
export function earliestMoment(left: number | null, right: number | null): number | null {
  return left === null ? right : right === null ? left : Math.min(left, right);
}

function git(root: string, args: string[]): string {
  recordSynchronousGitProcess(args);
  return execFileSync("git", ["--no-optional-locks", "-C", root, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function metadata(path: string): string[] | null {
  try {
    const stat = lstatSync(path, { bigint: true });
    return [
      stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other",
      stat.size.toString(),
      stat.mtimeNs.toString(),
      stat.ctimeNs.toString(),
      stat.ino.toString(),
    ];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** Paths named by porcelain v2 records; a second edit of a dirty file changes only its metadata. */
function porcelainStatusPaths(status: string): string[] {
  const records = status.split("\0");
  const paths: string[] = [];
  for (let index = 0; index < records.length; index++) {
    const record = records[index]!;
    if (record.length === 0 || record.startsWith("# ")) continue;
    const fields = record.split(" ");
    if (record[0] === "1" && fields.length >= 9) paths.push(fields.slice(8).join(" "));
    else if (record[0] === "2" && fields.length >= 10) {
      paths.push(fields.slice(9).join(" "));
      const original = records[++index];
      if (original === undefined || original.length === 0)
        throw new Error("Invalid repository status rename record.");
      paths.push(original);
    } else if (record[0] === "u" && fields.length >= 11) paths.push(fields.slice(10).join(" "));
    else if ((record[0] === "?" || record[0] === "!") && record[1] === " ")
      paths.push(record.slice(2));
    else throw new Error("Invalid repository status record.");
    if (paths.length > MAXIMUM_OBSERVED_PATHS)
      throw new Error("Repository status observation limit exceeded.");
  }
  return paths;
}

/**
 * Candidate stores are ignored by Git, so their shard and entry metadata is observed directly.
 * `depth` 2 reaches each entry; ADR-0599's non-owner digest stops at the shards (depth 1), whose
 * metadata moves whenever an entry is renamed in or out.
 */
function candidateMetadata(root: string, depth = 2): unknown[] {
  const state = resolve(root, KNOWLEDGE_STATE);
  let stores: string[];
  try {
    stores = readdirSync(state)
      .filter((name) => name.endsWith("candidates"))
      .sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const observed: unknown[] = [];
  let count = 0;
  const visit = (path: string, depth: number) => {
    if (++count > MAXIMUM_OBSERVED_PATHS) throw new Error("Candidate observation limit exceeded.");
    const own = metadata(path);
    observed.push([path.slice(state.length + 1), own]);
    if (own?.[0] !== "directory" || depth === 0) return;
    for (const name of readdirSync(path).sort()) visit(resolve(path, name), depth - 1);
  };
  for (const store of stores) visit(resolve(state, store), depth);
  return observed;
}

/**
 * ADR-0601: the identity of every knowledge candidate store entry. These stores live under
 * `.lervo/state`, outside the repository snapshot, so a cache of anything read from them keys on it.
 */
export function knowledgeCandidateStoreIdentity(root: string): string {
  return sha256(canonicalJson(candidateMetadata(root)));
}

/**
 * ADR-0463 adds the freshness findings digest and the hold store to the fence, so a changed
 * detection report or an owner hold wakes the resident; candidate stores are observed above.
 */
function freshnessObservation(root: string): unknown {
  let findingsDigest: unknown = null;
  try {
    const path = resolve(root, KNOWLEDGE_STATE, "freshness-cycle.json");
    if ((metadata(path)?.[0] ?? null) === "file")
      findingsDigest =
        (JSON.parse(readFileSync(path, "utf8")) as { findingsDigest?: unknown }).findingsDigest ??
        null;
  } catch {
    findingsDigest = "unreadable";
  }
  const holds = resolve(root, KNOWLEDGE_STATE, "freshness-holds");
  let entries: unknown[] = [];
  try {
    entries = readdirSync(holds)
      .sort()
      .slice(0, 1_024)
      .map((name) => [name, metadata(resolve(holds, name))]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { findingsDigest, holds: entries };
}

/** ADR-0467: a newly queued owner turn wakes the resident; names only, never the turn text. */
function instructionCaptureQueueNames(root: string): string[] {
  try {
    return readdirSync(resolve(root, KNOWLEDGE_STATE, "instruction-capture", "queue"))
      .filter((name) => name.endsWith(".json"))
      .sort()
      .slice(0, 1_024);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

/**
 * The cheap change fence of ADR-0461. Any read failure propagates so the caller runs a full cycle;
 * equality proves only that the observed inputs did not change, never document currency.
 */
export function convergenceRepositoryDigest(root: string): string {
  const [indexPath, head] = git(root, ["rev-parse", "--git-path", "index", "HEAD"])
    .trim()
    .split("\n");
  if (indexPath === undefined || head === undefined || !/^[a-f0-9]{40,64}$/u.test(head))
    throw new Error("Repository head observation is invalid.");
  const status = git(root, ["status", "--porcelain=v2", "-z", "--untracked-files=all"]);
  const index = metadata(resolve(root, indexPath));
  const settings = convergenceSourceCaptureSettings(root);
  return sha256(
    canonicalJson({
      head,
      status: sha256(status),
      dirty: porcelainStatusPaths(status).map((path) => [path, metadata(resolve(root, path))]),
      index: index === null ? null : { size: index[1], mtimeNs: index[2] },
      policy: sha256(canonicalJson(settings.policy)),
      delegation: settings.delegationContentHash,
      candidates: sha256(canonicalJson(candidateMetadata(root))),
      materialization: metadata(resolve(root, KNOWLEDGE_STATE, "materialization-transaction")),
      freshness: freshnessObservation(root),
      instructionCapture: instructionCaptureQueueNames(root),
    }),
  );
}

/**
 * ADR-0599: the digest a non-owner resident fences on. A non-owner inspects nothing (ADR-0597),
 * so it needs only what changes its host-local duties or its next role: HEAD, refs and index from
 * file metadata, the capture settings, the candidate shards, and the freshness, materialization
 * and owner-turn queue state. It runs no Git process and walks no candidate entry. A
 * working-tree-only edit is left to the owner: a non-owner's duties never read the working tree,
 * and a takeover changes the verdict in the fingerprint, so the new owner's first cycle runs the
 * full digest (ADR-0602).
 */
export function nonOwnerRepositoryDigest(root: string): string {
  const settings = convergenceSourceCaptureSettings(root);
  return sha256(
    canonicalJson({
      scope: "non_owner",
      repository: repositoryHeadIdentity(root),
      policy: sha256(canonicalJson(settings.policy)),
      delegation: settings.delegationContentHash,
      candidates: sha256(canonicalJson(candidateMetadata(root, 1))),
      materialization: metadata(resolve(root, KNOWLEDGE_STATE, "materialization-transaction")),
      freshness: freshnessObservation(root),
      instructionCapture: instructionCaptureQueueNames(root),
    }),
  );
}

/** The non-owner digest, or the full one when the checkout's Git metadata cannot be read directly. */
function residentRepositoryDigest(root: string, owner: boolean): string {
  if (owner) return convergenceRepositoryDigest(root);
  try {
    return nonOwnerRepositoryDigest(root);
  } catch {
    return convergenceRepositoryDigest(root);
  }
}

export function convergenceSourceFingerprint(input: {
  repositoryRoot: string;
  events: OutboxStore;
  /** ADR-0597: this resident's delay for the shared day-boundary wake. */
  wakeOffsetMilliseconds?: number;
  /**
   * ADR-0599: false when this host's last ownership verdict is not owner. A host without an
   * ownership observation, and any owner, keeps the full digest.
   */
  owner?: boolean;
}): ConvergenceSourceFingerprint {
  const sourceDigest = residentRepositoryDigest(input.repositoryRoot, input.owner !== false);
  const queue = observeConvergenceQueue(input.events, { owner: input.owner !== false });
  const now = Date.now();
  const offset = input.wakeOffsetMilliseconds ?? 0;
  // ADR-0595: practice enters the fence by what is due, not by a 30-minute clock window.
  // ADR-0602: an unreadable schedule enters by the state file's identity, so the full cycle,
  // whose practice stage reports the invalid state, runs once for it and again when it is
  // rewritten, with no clock window to wake for.
  let practiceDue: unknown;
  let practiceWakeAt: number | null;
  try {
    const schedule = observePracticeSchedule(input.repositoryRoot, now, offset);
    practiceDue = schedule.dueDigest;
    practiceWakeAt = schedule.nextDueAt;
  } catch {
    practiceDue = [
      "unreadable",
      metadata(resolve(input.repositoryRoot, PRACTICE_ROOT, "state.json")),
    ];
    practiceWakeAt = null;
  }
  const localWakeAt = earliestMoment(practiceWakeAt, nextUtcDayAt(now, offset));
  return {
    fingerprint: sha256(
      canonicalJson({
        sourceDigest,
        ...queue,
        terminalSkills: metadata(
          resolve(input.repositoryRoot, KNOWLEDGE_STATE, "terminal-skills", "queue"),
        ),
        practice: metadata(
          resolve(input.repositoryRoot, KNOWLEDGE_STATE, "practice", "state.json"),
        ),
        practiceDue,
        // ADR-0595: the host hold store lives outside the repository, so a hold or its release
        // changes the fence explicitly and wakes a backed-off held resident.
        repositoryHolds: metadata(defaultRepositoryHoldPath()),
        // The daily skill usage window; `localWakeAt` wakes the resident when it rolls over.
        terminalSkillsDay: new Date(now - offset).toISOString().slice(0, 10),
      }),
    ),
    sourceDigest,
    earliestAvailableAt: earliestMoment(queue.earliestAvailableAt, localWakeAt),
    localWakeAt,
  };
}
