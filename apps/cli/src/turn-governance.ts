import { governingDocumentsFor, type GoverningIndex } from "@lervo/repository-knowledge";

import { readPrivateStateJson, writePrivateStateJson } from "./private-state-file.js";

const INDEX = "governing-index.json";
const STATE = "turn-governance.json";
const WINDOW_MS = 7 * 86_400_000;
const MAXIMUM_TURNS = 500;
const MAXIMUM_SHOWN_DOCUMENTS = 5;
const MAXIMUM_SHOWN_CHANGES = 3;

/** One repository-changing turn: how many changed paths canon governs, and what it missed. */
export interface TurnGovernanceRecord {
  /** The prepared context event of the turn; a retried Stop for it records nothing new. */
  turnKey?: string;
  at: string;
  changedCount: number;
  governingCount: number;
  missedCount: number;
}

export interface TurnGovernanceState {
  schemaVersion: 1;
  turns: TurnGovernanceRecord[];
  /** The newest turn's misses, until an owner turn has been shown them. */
  pending: {
    turnKey?: string;
    at: string;
    changed: string[];
    missed: string[];
    shownAt: string | null;
  } | null;
}

export async function writeGoverningIndex(root: string, index: GoverningIndex): Promise<void> {
  await writePrivateStateJson(root, INDEX, { schemaVersion: 1, ...index });
}

export async function governingIndexPresent(root: string): Promise<boolean> {
  return (await readGoverningIndex(root)) !== null;
}

async function readGoverningIndex(root: string): Promise<GoverningIndex | null> {
  const value = (await readPrivateStateJson(root, INDEX, 4 * 1024 * 1024)) as
    (GoverningIndex & { schemaVersion?: unknown }) | null;
  return value?.schemaVersion === 1 &&
    Array.isArray(value.documents) &&
    value.entries !== null &&
    typeof value.entries === "object"
    ? value
    : null;
}

export async function readTurnGovernance(root: string): Promise<TurnGovernanceState | null> {
  const value = (await readPrivateStateJson(root, STATE, 256 * 1024)) as TurnGovernanceState | null;
  return value?.schemaVersion === 1 && Array.isArray(value.turns) ? value : null;
}

/**
 * ADR-0552: at Stop, canonical documents that name a changed path but that the turn neither
 * selected nor edited are misses. A missing index records nothing, so absence never reads as zero.
 */
export async function recordTurnGovernance(input: {
  root: string;
  turnKey: string;
  changedPaths: readonly string[];
  selectedPaths: readonly string[];
  at: string;
}): Promise<void> {
  if (input.changedPaths.length === 0) return;
  const index = await readGoverningIndex(input.root);
  if (index === null) return;
  const changed = new Set(input.changedPaths);
  const consulted = new Set([...input.selectedPaths, ...input.changedPaths]);
  const governing = new Set<string>();
  const governedChanges: string[] = [];
  for (const path of input.changedPaths) {
    if (/\.mdx?$/iu.test(path)) continue;
    const documents = governingDocumentsFor(index, path);
    if (documents.length > 0) governedChanges.push(path);
    for (const document of documents) governing.add(document);
  }
  const missed = [...governing].filter((document) => !consulted.has(document)).sort();
  const previous = await readTurnGovernance(input.root);
  // A retried Stop may have lost its turn selection, so only the first record of a turn counts.
  if (previous?.turns.some((turn) => turn.turnKey === input.turnKey)) return;
  const start = Date.parse(input.at) - WINDOW_MS;
  const turns = [
    ...(previous?.turns ?? []).filter((turn) => Date.parse(turn.at) >= start),
    {
      turnKey: input.turnKey,
      at: input.at,
      changedCount: changed.size,
      governingCount: governing.size,
      missedCount: missed.length,
    },
  ].slice(-MAXIMUM_TURNS);
  await writePrivateStateJson(input.root, STATE, {
    schemaVersion: 1,
    turns,
    pending:
      missed.length === 0
        ? null
        : {
            turnKey: input.turnKey,
            at: input.at,
            changed: governedChanges.slice(0, MAXIMUM_SHOWN_CHANGES),
            missed: missed.slice(0, MAXIMUM_SHOWN_DOCUMENTS),
            shownAt: null,
          },
  } satisfies TurnGovernanceState);
}

/** The pending check for the next owner turn, or null when nothing is pending. */
export function pendingTurnGovernance(
  state: TurnGovernanceState | null,
): { pendingAt: string; line: string } | null {
  const line = turnGovernanceLine(state);
  return line === null ? null : { pendingAt: state!.pending!.at, line };
}

export function turnGovernanceLine(state: TurnGovernanceState | null): string | null {
  const pending = state?.pending ?? null;
  if (pending === null || pending.shownAt !== null) return null;
  return `Lervo check: the last turn changed ${pending.changed.join(", ")} without consulting the canon that names it: ${pending.missed.join(", ")}. Verify the change against these sources before building on it.`;
}

/** Marks only the pending check that this turn showed; a newer one stays pending. */
export async function markTurnGovernanceShown(
  root: string,
  pendingAt: string,
  at: string,
): Promise<void> {
  const state = await readTurnGovernance(root);
  if (state?.pending == null || state.pending.shownAt !== null || state.pending.at !== pendingAt)
    return;
  await writePrivateStateJson(root, STATE, {
    ...state,
    pending: { ...state.pending, shownAt: at },
  });
}

/** Seven-day turns whose changes canon governs, and the share that missed governing documents. */
export function turnGovernanceSummary(
  state: TurnGovernanceState | null,
  now: Date,
): { governedTurnCount: number; missedTurnCount: number } | null {
  if (state === null) return null;
  const start = now.getTime() - WINDOW_MS;
  const turns = state.turns.filter(
    (turn) => Date.parse(turn.at) >= start && Date.parse(turn.at) <= now.getTime(),
  );
  const governed = turns.filter((turn) => turn.governingCount > 0);
  return {
    governedTurnCount: governed.length,
    missedTurnCount: governed.filter((turn) => turn.missedCount > 0).length,
  };
}
