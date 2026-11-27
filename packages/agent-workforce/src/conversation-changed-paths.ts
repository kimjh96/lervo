import { mkdir, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { MAXIMUM_CONVERSATION_EXPECTED_PATHS } from "./assignment-path-bounds.js";
import { normalizeClaimPath } from "./conversation-claim-input.js";
import { coalesceLeaseEntries, minimalPathCover } from "./conversation-lease-coalescing.js";
import { isConversationWorkspace, newestConversationWorkspace } from "./conversation-workspace.js";
import { atomicWrite, readBounded, state, workforceStateFits } from "./workforce-state-io.js";
import { fail, validTime } from "./workforce-state-validation.js";
import { listWorkspaces } from "./workspace-store.js";
import type { AgentWorkspace } from "./workspace-types.js";

/**
 * The paths one conversation generation changed since its base, as its latest reconciliation
 * found them (Lervo ADE coordination, "Reconciliation"). They hold their paths for every other
 * claim until the generation seals (`path_changed_unsealed`).
 *
 * They live beside the workspace record, one file per generation in the workforce's
 * `conversation-changes` directory, rather than in the record: a record write advances the
 * revision that a session's workspace binding checks, and every claim lists every record, which
 * would then carry up to 10,000 paths per generation.
 */
export interface ConversationChangedPaths {
  schemaVersion: 1;
  /** The generation's workspace record ID. */
  workspaceId: string;
  conversationId: string;
  generation: number;
  /** The base the paths were measured from, which must still be the record's. */
  baseCommit: string;
  /**
   * The paths the generation holds: a sorted minimal cover of at most 10,000 entries, coalesced
   * past that into directories. Empty when `overflow`.
   */
  paths: string[];
  /** How many claimable paths the reconciliation found, before coalescing. */
  changedPathCount: number;
  coalesced: boolean;
  /** The paths fit no bound even coalesced, so the generation holds its whole checkout. */
  overflow: boolean;
  recordedAt: string;
}

/** The path a generation holds when it holds its whole checkout, which overlaps every path. */
export const CHECKOUT_HOLDER_PATH = ".";

const DIRECTORY = "conversation-changes";
const WORKSPACE_ID = /^wsp_[a-f0-9]{24}$/u;
const COMMIT = /^[a-f0-9]{40,64}$/u;
const GLOB = /[*?[\]]/u;
/** Lervo's runtime paths, which no sealed change may contain and no claim names. */
const RUNTIME_PATHS = [".lervo/state", ".lervo/data", ".lervo/run"];

function serialized(record: ConversationChangedPaths): string {
  return `${JSON.stringify(record, null, 2)}\n`;
}

async function directory(repositoryRoot: string): Promise<string> {
  const path = resolve((await state(repositoryRoot)).base, DIRECTORY);
  await mkdir(path, { recursive: true, mode: 0o700 });
  return path;
}

/**
 * The path a claim names for a changed path: the path itself, or for a name with a glob
 * character, the deepest directory before it, as the claim handler names a glob operand. A
 * runtime path, or one the path policy cannot name, holds nothing.
 */
export function claimableChangedPath(path: string): string | null {
  if (RUNTIME_PATHS.some((runtime) => path === runtime || path.startsWith(`${runtime}/`)))
    return null;
  const glob = path.search(GLOB);
  const named = glob === -1 ? path : path.slice(0, Math.max(0, path.lastIndexOf("/", glob)));
  return named === "" ? null : normalizeClaimPath(named);
}

/**
 * The bounded set a generation holds for `changedPaths`: the claimable paths' minimal cover, and
 * past 10,000 entries the deepest directories that bring it within the bound. When even that
 * cannot fit, the generation holds its whole checkout.
 */
export function heldChangedPaths(
  changedPaths: readonly string[],
): Pick<ConversationChangedPaths, "paths" | "changedPathCount" | "coalesced" | "overflow"> {
  const claimable = minimalPathCover(
    changedPaths.flatMap((path) => claimableChangedPath(path) ?? []),
  );
  if (claimable.length <= MAXIMUM_CONVERSATION_EXPECTED_PATHS)
    return {
      paths: claimable,
      changedPathCount: claimable.length,
      coalesced: false,
      overflow: false,
    };
  const coalesced = coalesceLeaseEntries({
    entries: claimable,
    limit: MAXIMUM_CONVERSATION_EXPECTED_PATHS,
    isHeld: () => false,
    responsibilityPaths: ["."],
  });
  return coalesced === null
    ? { paths: [], changedPathCount: claimable.length, coalesced: false, overflow: true }
    : { paths: coalesced, changedPathCount: claimable.length, coalesced: true, overflow: false };
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
    Array.isArray(record.paths) &&
    record.paths.length <= MAXIMUM_CONVERSATION_EXPECTED_PATHS &&
    record.paths.every((path) => normalizeClaimPath(path) === path) &&
    Number.isSafeInteger(record.changedPathCount) &&
    record.changedPathCount >= record.paths.length &&
    typeof record.coalesced === "boolean" &&
    typeof record.overflow === "boolean" &&
    (!record.overflow || record.paths.length === 0) &&
    validTime(record.recordedAt)
  );
}

/**
 * Records what a conversation generation changed since its base, replacing its previous record
 * whole. Every write also removes the records of generations that are gone or `removed`, so the
 * directory holds at most one file per live workspace record.
 */
export async function recordConversationChangedPaths(input: {
  repositoryRoot: string;
  workspace: AgentWorkspace;
  /** Repository-relative paths changed since the generation's base, as Git names them. */
  changedPaths: readonly string[];
  /** Every workspace record, to prune the records of generations that are gone. */
  workspaces: readonly AgentWorkspace[];
  now: Date;
}): Promise<ConversationChangedPaths> {
  const { workspace } = input;
  if (
    !isConversationWorkspace(workspace) ||
    !input.changedPaths.every((path) => typeof path === "string")
  )
    fail("workspace_invalid", "Only a conversation generation records its changed paths.");
  const held = heldChangedPaths(input.changedPaths);
  let record: ConversationChangedPaths = {
    schemaVersion: 1,
    workspaceId: workspace.workspaceId,
    conversationId: workspace.conversationId!,
    generation: workspace.generation,
    baseCommit: workspace.baseCommit,
    ...held,
    recordedAt: input.now.toISOString(),
  };
  // Paths at their length bound could still pass the state bound; the checkout then holds whole.
  if (!workforceStateFits(serialized(record)))
    record = { ...record, paths: [], coalesced: false, overflow: true };
  const folder = await directory(input.repositoryRoot);
  await atomicWrite(resolve(folder, `${record.workspaceId}.json`), serialized(record));
  await pruneChangedPaths(folder, input.workspaces);
  return record;
}

async function pruneChangedPaths(
  folder: string,
  workspaces: readonly AgentWorkspace[],
): Promise<void> {
  const live = new Set(
    workspaces
      .filter((workspace) => workspace.state !== "removed")
      .map((workspace) => workspace.workspaceId),
  );
  for (const name of await readdir(folder)) {
    const workspaceId = name.slice(0, -".json".length);
    if (name.endsWith(".json") && WORKSPACE_ID.test(workspaceId) && !live.has(workspaceId))
      await rm(resolve(folder, name), { force: true });
  }
}

/** One generation's record in `folder`, or null when it has none. */
async function readRecord(
  folder: string,
  workspaceId: string,
): Promise<ConversationChangedPaths | null> {
  const content = await readBounded(resolve(folder, `${workspaceId}.json`));
  if (content === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (error) {
    fail("workforce_state_invalid", "A conversation's changed paths are not valid JSON.", error);
  }
  if (!validRecord(value, workspaceId))
    fail("workforce_state_invalid", "A conversation's recorded changed paths are invalid.");
  return value;
}

/** Every generation's recorded changed paths, by workspace record ID. */
export async function listConversationChangedPaths(
  repositoryRoot: string,
): Promise<Map<string, ConversationChangedPaths>> {
  const folder = resolve((await state(repositoryRoot)).base, DIRECTORY);
  let names: string[];
  try {
    names = await readdir(folder);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
    throw error;
  }
  const records = new Map<string, ConversationChangedPaths>();
  for (const name of names) {
    const workspaceId = name.slice(0, -".json".length);
    if (!name.endsWith(".json") || !WORKSPACE_ID.test(workspaceId)) continue;
    const record = await readRecord(folder, workspaceId);
    if (record !== null) records.set(workspaceId, record);
  }
  return records;
}

/** The most paths a reader of one conversation's changes receives; `total` counts them all. */
export const READ_CHANGED_PATHS_LIMIT = 100;

/**
 * A conversation's changed paths that are not sealed yet, as its newest open generation's latest
 * reconciliation recorded them: at most 100 sorted paths, how many it holds in all, and when it
 * recorded them. Null when no open generation has a current record. `overflow` means the
 * generation holds its whole checkout. It reads only and writes nothing.
 */
export async function readConversationChangedPaths(
  repositoryRoot: string,
  conversationId: string,
): Promise<{ paths: string[]; total: number; overflow: boolean; recordedAt: string } | null> {
  if (!WORKSPACE_ID.test(conversationId)) return null;
  const generation = newestConversationWorkspace(
    await listWorkspaces(repositoryRoot),
    conversationId,
  );
  if (generation === null || !["ready", "active", "paused"].includes(generation.state)) return null;
  const folder = resolve((await state(repositoryRoot, { readOnly: true })).base, DIRECTORY);
  const record = await readRecord(folder, generation.workspaceId);
  if (
    record === null ||
    record.generation !== generation.generation ||
    record.baseCommit !== generation.baseCommit
  )
    return null;
  return {
    paths: record.paths.slice(0, READ_CHANGED_PATHS_LIMIT),
    total: record.paths.length,
    overflow: record.overflow,
    recordedAt: record.recordedAt,
  };
}
