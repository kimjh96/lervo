import { lstat, mkdir, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { inspectRepositoryCoordinationHome } from "@lervo/project-storage";

import { MAXIMUM_CONVERSATION_EXPECTED_PATHS } from "./assignment-path-bounds.js";
import type { ChangedPathHolder } from "./assignment-path-conflict.js";
import { normalizeClaimPath } from "./conversation-claim-input.js";
import { heldChangedPaths } from "./conversation-changed-path-bounds.js";
import {
  conversationWorkspaceRecordId,
  isConversationWorkspace,
  newestConversationWorkspace,
} from "./conversation-workspace.js";
import type { WorkforceAssignment } from "./types.js";
import { atomicWrite, readBounded, state, workforceStateFits } from "./workforce-state-io.js";
import { fail, validTime } from "./workforce-state-validation.js";
import { isAgentWorkspace } from "./workspace-lifecycle.js";
import { readWorkspace } from "./workspace-store.js";
import type { AgentWorkspace, WorkspaceState } from "./workspace-types.js";

/**
 * The paths one conversation generation changed, as its latest reconciliation found them (Lervo
 * ADE coordination, "Reconciliation"). They hold their paths for every other claim while the
 * generation is open and active (`path_changed_unsealed`).
 *
 * They live beside the workspace record, one file per generation in the workforce's
 * `conversation-changes` directory, rather than in the record: a record write advances the
 * revision that a session's workspace binding checks, and every claim would then read up to
 * 10,000 paths per generation. Claimed paths stay in the assignment's `expectedPaths`.
 */
export interface ConversationChangedPaths {
  schemaVersion: 1;
  /** The generation's workspace record ID. */
  workspaceId: string;
  conversationId: string;
  generation: number;
  /** The generation's recorded base, which must still be the record's. */
  baseCommit: string;
  /** The commit the paths were measured from: where the branch last met its target. */
  measuredFrom: string;
  /** The entries the generation holds: a sorted minimal cover within the count and byte bounds. */
  paths: string[];
  /** How many paths the reconciliation found changed, before any coalescing. */
  changedPathCount: number;
  /** Directories stand for some of the changed paths. */
  coalesced: boolean;
  /**
   * The change fit no bound even coalesced: the generation holds its top-level entries, as many
   * as fit, claims nothing, and cannot seal until it shrinks.
   */
  overflow: boolean;
  recordedAt: string;
}

const DIRECTORY = "conversation-changes";
const WORKSPACE_ID = /^wsp_[a-f0-9]{24}$/u;
const COMMIT = /^[a-f0-9]{40,64}$/u;
/** States whose changed paths hold until the generation seals. */
const UNSEALED: ReadonlySet<WorkspaceState> = new Set(["ready", "active", "paused"]);
/**
 * How long after its lease expired a generation's changes still hold. An abandoned or retired
 * conversation renews nothing, so its changes stop holding a day after its last claim, turn end,
 * or renewal; an active one renews at least every 10 minutes.
 */
export const CHANGED_PATHS_HOLD_AFTER_LEASE_MS = 24 * 60 * 60_000;

function serialized(record: ConversationChangedPaths): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

/** The changes directory of a workforce directory. */
function changesFolder(workforceDirectory: string): string {
  return resolve(workforceDirectory, DIRECTORY);
}

/** The changes directory for a write, resolving and preparing the coordination home. */
async function writableFolder(repositoryRoot: string): Promise<string> {
  return changesFolder((await state(repositoryRoot)).base);
}

/** The changes directory for a read, or null when the coordination home does not exist yet. */
async function readableFolder(repositoryRoot: string): Promise<string | null> {
  const home = await inspectRepositoryCoordinationHome(repositoryRoot).catch(() => null);
  return home === null ? null : changesFolder(home.workforce);
}

function validRecord(value: unknown, workspaceId: string): value is ConversationChangedPaths {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as ConversationChangedPaths;
  return (
    record.schemaVersion === 1 &&
    record.workspaceId === workspaceId &&
    typeof record.conversationId === "string" &&
    WORKSPACE_ID.test(record.conversationId) &&
    Number.isSafeInteger(record.generation) &&
    record.generation >= 1 &&
    typeof record.baseCommit === "string" &&
    COMMIT.test(record.baseCommit) &&
    typeof record.measuredFrom === "string" &&
    COMMIT.test(record.measuredFrom) &&
    Array.isArray(record.paths) &&
    record.paths.length <= MAXIMUM_CONVERSATION_EXPECTED_PATHS &&
    record.paths.every((path) => normalizeClaimPath(path) === path) &&
    Number.isSafeInteger(record.changedPathCount) &&
    record.changedPathCount >= 0 &&
    typeof record.coalesced === "boolean" &&
    typeof record.overflow === "boolean" &&
    validTime(record.recordedAt)
  );
}

/**
 * Records what a conversation generation changed, replacing its previous record whole. Every
 * write also removes the files of generations whose record is gone or `removed`, rereading each
 * record before it removes its file, so the directory holds at most one file per live record.
 */
export async function recordConversationChangedPaths(input: {
  repositoryRoot: string;
  workspace: AgentWorkspace;
  /** Repository-relative paths changed since `measuredFrom`, as Git names them. */
  changedPaths: readonly string[];
  measuredFrom: string;
  /** Every workspace record as the caller read it, so pruning rereads only the others. */
  workspaces: readonly AgentWorkspace[];
  now: Date;
}): Promise<ConversationChangedPaths> {
  const { workspace } = input;
  if (
    !isConversationWorkspace(workspace) ||
    !COMMIT.test(input.measuredFrom) ||
    !input.changedPaths.every((path) => typeof path === "string")
  )
    fail("workspace_invalid", "Only a conversation generation records its changed paths.");
  const record: ConversationChangedPaths = {
    schemaVersion: 1,
    workspaceId: workspace.workspaceId,
    conversationId: workspace.conversationId!,
    generation: workspace.generation,
    baseCommit: workspace.baseCommit,
    measuredFrom: input.measuredFrom,
    ...heldChangedPaths(input.changedPaths),
    recordedAt: input.now.toISOString(),
  };
  if (!workforceStateFits(serialized(record)))
    fail("workforce_write_failed", "The conversation's changed paths exceed the state bound.");
  const folder = await writableFolder(input.repositoryRoot);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await atomicWrite(resolve(folder, `${record.workspaceId}.json`), serialized(record));
  await pruneChangedPaths(input.repositoryRoot, folder, input.workspaces);
  return record;
}

/** Removes the files of records that are gone or `removed` now, never one a reread finds live. */
async function pruneChangedPaths(
  repositoryRoot: string,
  folder: string,
  workspaces: readonly AgentWorkspace[],
): Promise<void> {
  const live = new Set(
    workspaces.filter((item) => item.state !== "removed").map((item) => item.workspaceId),
  );
  for (const workspaceId of await recordIds(folder)) {
    if (live.has(workspaceId)) continue;
    const current = await readWorkspace(repositoryRoot, workspaceId).catch(() => undefined);
    if (current === null || current?.workspace.state === "removed")
      await rm(resolve(folder, `${workspaceId}.json`), { force: true });
  }
}

/**
 * Removes the changes files of every record that is gone or `removed`, as retiring a conversation
 * needs once its records moved to `removed`. It writes nothing while the coordination home does
 * not exist, and it rereads each record before it removes its file.
 */
export async function pruneConversationChangedPaths(
  repositoryRoot: string,
  workspaces: readonly AgentWorkspace[],
): Promise<void> {
  const folder = await readableFolder(repositoryRoot);
  if (folder !== null) await pruneChangedPaths(repositoryRoot, folder, workspaces);
}

/** The record IDs that have a file, or none when the directory does not exist. */
async function recordIds(folder: string): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(folder);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  return names
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .filter((workspaceId) => WORKSPACE_ID.test(workspaceId));
}

/**
 * One generation's record, or null when it has none or it cannot be used: unsafe, unreadable,
 * or of a shape this release does not read. A record never fails a claim; it just holds nothing.
 */
async function readRecord(
  folder: string,
  workspaceId: string,
): Promise<ConversationChangedPaths | null> {
  try {
    const content = await readBounded(resolve(folder, `${workspaceId}.json`));
    if (content === null) return null;
    const value: unknown = JSON.parse(content);
    return validRecord(value, workspaceId) ? value : null;
  } catch {
    return null;
  }
}

async function directoryExists(path: string | undefined): Promise<boolean> {
  if (path === undefined) return false;
  const info = await lstat(path).catch(() => null);
  return info !== null && info.isDirectory();
}

/**
 * Whether a generation's recorded changes hold now: the record still speaks for the same open
 * generation and base, its worktree still exists, and its lease expired less than a day ago.
 */
async function holds(
  workspace: AgentWorkspace,
  record: ConversationChangedPaths,
  assignment: WorkforceAssignment | undefined,
  now: Date,
): Promise<boolean> {
  const lease = assignment?.lease ?? null;
  return (
    UNSEALED.has(workspace.state) &&
    record.generation === workspace.generation &&
    record.baseCommit === workspace.baseCommit &&
    lease !== null &&
    Date.parse(lease.expiresAt) > now.getTime() - CHANGED_PATHS_HOLD_AFTER_LEASE_MS &&
    (await directoryExists(workspace.ownerWorkspacePath))
  );
}

/**
 * Other conversations' unsealed changed paths as holders of a claim, read at its moment. It reads
 * only the generations that have a changes file, so a repository where no conversation ever
 * reconciled pays one directory read. A record or file it cannot use holds nothing.
 */
export async function readUnsealedChangedPathHolders(input: {
  repositoryRoot: string;
  /** The workforce directory the claim already resolved; reading it prepares nothing. */
  workforceDirectory: string;
  /** The claimant's conversation, whose own generations never hold against it. */
  claimantConversationId: string | null;
  /** Every assignment, as the claim read them under the scheduler lock. */
  assignments: readonly WorkforceAssignment[];
  now: Date;
}): Promise<ChangedPathHolder[]> {
  const folder = changesFolder(input.workforceDirectory);
  const holders: ChangedPathHolder[] = [];
  for (const workspaceId of await recordIds(folder)) {
    const workspace = (await readWorkspace(input.repositoryRoot, workspaceId).catch(() => null))
      ?.workspace;
    if (
      workspace === undefined ||
      !isConversationWorkspace(workspace) ||
      workspace.conversationId === input.claimantConversationId
    )
      continue;
    const record = await readRecord(folder, workspaceId);
    const assignment = input.assignments.find(
      (item) => item.assignmentId === workspace.assignmentId,
    );
    if (record === null || !(await holds(workspace, record, assignment, input.now))) continue;
    for (const path of record.paths)
      holders.push({
        path,
        holderAgentId: workspace.agentId,
        holderWorkspaceId: workspace.conversationId!,
        holderAssignmentId: workspace.assignmentId,
        code: "path_changed_unsealed",
      });
  }
  return holders;
}

/** Every generation's usable recorded changed paths, by workspace record ID. */
export async function listConversationChangedPaths(
  repositoryRoot: string,
): Promise<Map<string, ConversationChangedPaths>> {
  const folder = await readableFolder(repositoryRoot);
  const records = new Map<string, ConversationChangedPaths>();
  if (folder === null) return records;
  for (const workspaceId of await recordIds(folder)) {
    const record = await readRecord(folder, workspaceId);
    if (record !== null) records.set(workspaceId, record);
  }
  return records;
}

/** The most paths a reader of one conversation's changes receives. */
export const READ_CHANGED_PATHS_LIMIT = 100;

/** A conversation's changed paths that are not sealed yet, for the ADE. */
export interface ConversationChangedPathsSummary {
  /** At most 100 of the entries held, sorted. */
  paths: string[];
  /** How many paths changed. */
  total: number;
  /** How many entries the generation holds; fewer than `total` when directories stand for paths. */
  heldEntries: number;
  coalesced: boolean;
  /** The change fit no bound: it holds its top-level entries and cannot seal until it shrinks. */
  overflow: boolean;
  recordedAt: string;
}

/** Generations a reader looks up one by one before it stops. */
const MAXIMUM_READ_GENERATIONS = 1_000;

/** A workspace record read straight from its file, or null when it is absent or unusable. */
async function readRecordFile(
  directory: string,
  workspaceId: string,
): Promise<AgentWorkspace | null> {
  try {
    const content = await readBounded(resolve(directory, `${workspaceId}.json`));
    if (content === null) return null;
    const value: unknown = JSON.parse(content);
    return isAgentWorkspace(value as AgentWorkspace) ? (value as AgentWorkspace) : null;
  } catch {
    return null;
  }
}

/**
 * A conversation's changed paths that are not sealed yet, as its newest open generation's latest
 * reconciliation recorded them, or null when that generation has no current record or the
 * coordination home does not exist. It reads each generation's record by its derived ID and
 * writes nothing, not even a directory.
 */
export async function readConversationChangedPaths(
  repositoryRoot: string,
  conversationId: string,
): Promise<ConversationChangedPathsSummary | null> {
  if (!WORKSPACE_ID.test(conversationId)) return null;
  const home = await inspectRepositoryCoordinationHome(repositoryRoot).catch(() => null);
  if (home === null) return null;
  const generations: AgentWorkspace[] = [];
  for (let generation = 1; generation <= MAXIMUM_READ_GENERATIONS; generation += 1) {
    const workspaceId = conversationWorkspaceRecordId(conversationId, generation);
    const workspace = await readRecordFile(home.workspaces, workspaceId);
    if (workspace === null) break;
    generations.push(workspace);
  }
  const generation = newestConversationWorkspace(generations, conversationId);
  if (generation === null || !UNSEALED.has(generation.state)) return null;
  const record = await readRecord(changesFolder(home.workforce), generation.workspaceId);
  if (
    record === null ||
    record.generation !== generation.generation ||
    record.baseCommit !== generation.baseCommit
  )
    return null;
  return {
    paths: record.paths.slice(0, READ_CHANGED_PATHS_LIMIT),
    total: record.changedPathCount,
    heldEntries: record.paths.length,
    coalesced: record.coalesced,
    overflow: record.overflow,
    recordedAt: record.recordedAt,
  };
}
