import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { InstructionCaptureSurface } from "@lervo/repository-knowledge";

import { INSTRUCTION_CAPTURE_ROOT } from "./instruction-capture-queue.js";

/**
 * Rebuildable capture bookkeeping (ADR-0467): the hourly and daily budget windows, tombstones
 * that stop a turn from being assessed twice, and held items that wait for the owner. Held items
 * contain only the provider's normalized title and statement, never owner or agent turn text.
 */
export const INSTRUCTION_CAPTURE_STATE_PATH = `${INSTRUCTION_CAPTURE_ROOT}/state.json`;

export const MAXIMUM_ASSESSMENTS_PER_CYCLE = 4;
export const MAXIMUM_ASSESSMENTS_PER_HOUR = 12;
export const MAXIMUM_ASSESSMENTS_PER_DAY = 60;
/**
 * One assessment with its cross-check spends about 32k tokens. The daily token budget covers every
 * assessment the daily count allows, so the count, not the tokens, bounds a busy day; a flat
 * 200k stopped capture after about 13 turns.
 */
export const MAXIMUM_CAPTURE_TOKENS_PER_ASSESSMENT = 32_000;
export const MAXIMUM_CAPTURE_TOKENS_PER_DAY =
  MAXIMUM_ASSESSMENTS_PER_DAY * MAXIMUM_CAPTURE_TOKENS_PER_ASSESSMENT;
const MAXIMUM_TOMBSTONES = 256;
const TOMBSTONE_RETENTION_MILLISECONDS = 7 * 86_400_000;
const MAXIMUM_HELD_ITEMS = 16;
const HELD_RETENTION_MILLISECONDS = 30 * 86_400_000;
const MAXIMUM_STATE_BYTES = 256 * 1024;

/**
 * Lervo's own unresolved capture work (ADR-0561); none of it waits for the owner. `decision`: a
 * settled choice the owner stated, for Lervo to record in canonical documents.
 * `cross_check_disagreement`: a captured rule the independent cross-check rejected.
 * `rule_needs_clarification`: written only before ADR-0561, read so older state still projects.
 */
export interface HeldCapture {
  captureId: string;
  kind: "decision" | "cross_check_disagreement" | "rule_needs_clarification";
  source: InstructionCaptureSurface;
  title: string;
  statement: string;
  subjectKey: string | null;
  summaryHash: string;
  capturedAt: string;
}

export interface InstructionCaptureState {
  schemaVersion: 1;
  budget: {
    day: string;
    hour: string;
    assessmentsToday: number;
    assessmentsThisHour: number;
    tokensToday: number;
  };
  assessed: Array<{ captureId: string; at: string }>;
  held: HeldCapture[];
  lastCycleAt: string | null;
  /**
   * Set while owner turns are queued but this host has no background-work authority (no active
   * delegation for its provider); cleared by the next assessment or an empty queue (ADR-0467).
   */
  authorityBlocked?: { since: string; queuedCount: number } | null;
}

export function emptyInstructionCaptureState(): InstructionCaptureState {
  return {
    schemaVersion: 1,
    budget: { day: "", hour: "", assessmentsToday: 0, assessmentsThisHour: 0, tokensToday: 0 },
    assessed: [],
    held: [],
    lastCycleAt: null,
  };
}

export async function readInstructionCaptureState(root: string): Promise<InstructionCaptureState> {
  const path = resolve(root, INSTRUCTION_CAPTURE_STATE_PATH);
  try {
    const observed = await lstat(path);
    if (!observed.isFile() || observed.size > MAXIMUM_STATE_BYTES)
      return emptyInstructionCaptureState();
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<InstructionCaptureState>;
    if (
      value.schemaVersion !== 1 ||
      typeof value.budget !== "object" ||
      value.budget === null ||
      !Array.isArray(value.assessed) ||
      !Array.isArray(value.held)
    )
      return emptyInstructionCaptureState();
    return value as InstructionCaptureState;
  } catch {
    return emptyInstructionCaptureState();
  }
}

/** Applies retention bounds before every write so the file cannot grow with operation count. */
export function compactInstructionCaptureState(
  state: InstructionCaptureState,
  now: Date,
): InstructionCaptureState {
  const at = now.getTime();
  return {
    ...state,
    assessed: state.assessed
      .filter((entry) => at - Date.parse(entry.at) < TOMBSTONE_RETENTION_MILLISECONDS)
      .slice(-MAXIMUM_TOMBSTONES),
    held: state.held
      .filter((entry) => at - Date.parse(entry.capturedAt) < HELD_RETENTION_MILLISECONDS)
      .slice(-MAXIMUM_HELD_ITEMS),
  };
}

export async function writeInstructionCaptureState(
  root: string,
  state: InstructionCaptureState,
  now: Date,
): Promise<void> {
  let directory = resolve(root);
  for (const part of INSTRUCTION_CAPTURE_ROOT.split("/")) {
    directory = resolve(directory, part);
    await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
  }
  const temporary = resolve(directory, `.state-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(compactInstructionCaptureState(state, now))}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await chmod(temporary, 0o600);
    await rename(temporary, resolve(root, INSTRUCTION_CAPTURE_STATE_PATH));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** Rolls the hourly and daily windows forward; counters reset when their window changes. */
export function currentCaptureBudget(
  state: InstructionCaptureState,
  now: Date,
): InstructionCaptureState["budget"] {
  const day = now.toISOString().slice(0, 10);
  const hour = now.toISOString().slice(0, 13);
  return {
    day,
    hour,
    assessmentsToday: state.budget.day === day ? state.budget.assessmentsToday : 0,
    assessmentsThisHour: state.budget.hour === hour ? state.budget.assessmentsThisHour : 0,
    tokensToday: state.budget.day === day ? state.budget.tokensToday : 0,
  };
}

export function captureBudgetAvailable(budget: InstructionCaptureState["budget"]): boolean {
  return (
    budget.assessmentsThisHour < MAXIMUM_ASSESSMENTS_PER_HOUR &&
    budget.assessmentsToday < MAXIMUM_ASSESSMENTS_PER_DAY &&
    budget.tokensToday < MAXIMUM_CAPTURE_TOKENS_PER_DAY
  );
}

/** Removes one held item; returns false when it was not held. */
export async function dismissHeldCapture(
  root: string,
  captureId: string,
  now: Date,
): Promise<boolean> {
  const state = await readInstructionCaptureState(root);
  const held = state.held.filter((entry) => entry.captureId !== captureId);
  if (held.length === state.held.length) return false;
  await writeInstructionCaptureState(root, { ...state, held }, now);
  return true;
}
