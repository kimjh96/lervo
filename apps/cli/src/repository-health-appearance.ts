import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * ADR-0548: the first time a convergence stop line is placed in an owner turn's context. This is
 * `prepared` delivery: it proves the line reached the turn context, not that the owner read it.
 */
export interface HealthStopAppearance {
  since: string;
  reason: string | null;
  firstPreparedAt: string;
}

export interface HealthAppearanceState {
  schemaVersion: 1;
  /** Stops that started before this time predate recording, so their appearance is unknown. */
  recordingSince: string;
  stops: HealthStopAppearance[];
}

const DIRECTORY = ".lervo/state";
const FILE = "repository-health-appearance.json";
const MAXIMUM_STOPS = 64;
const MAXIMUM_BYTES = 64 * 1024;

const isTime = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

function valid(value: unknown): value is HealthAppearanceState {
  const state = value as HealthAppearanceState | null;
  return (
    state?.schemaVersion === 1 &&
    isTime(state.recordingSince) &&
    Array.isArray(state.stops) &&
    state.stops.length <= MAXIMUM_STOPS &&
    state.stops.every(
      (stop) =>
        isTime(stop?.since) &&
        isTime(stop.firstPreparedAt) &&
        (stop.reason === null || typeof stop.reason === "string"),
    )
  );
}

/** Missing, oversized, or invalid state is null; readers then report appearance as unknown. */
export async function readHealthAppearance(root: string): Promise<HealthAppearanceState | null> {
  try {
    const path = resolve(root, DIRECTORY, FILE);
    const stats = await lstat(path);
    if (!stats.isFile() || stats.size > MAXIMUM_BYTES) return null;
    const value: unknown = JSON.parse(await readFile(path, "utf8"));
    return valid(value) ? value : null;
  } catch {
    return null;
  }
}

async function writeHealthAppearance(root: string, state: HealthAppearanceState): Promise<void> {
  const directory = resolve(root, DIRECTORY);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink())
    throw new Error("Unsafe repository health state directory.");
  const temporary = resolve(directory, `.health-appearance-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(`${JSON.stringify(state)}\n`);
    await handle.close();
    handle = undefined;
    await rename(temporary, resolve(directory, FILE));
  } finally {
    await handle?.close();
    await rm(temporary, { force: true });
  }
}

/**
 * Starts recording on the first owner turn, then records each stop's first prepared appearance.
 * It writes only when something changes. A lost race only delays one stop's time to the next turn.
 */
export async function recordHealthStopAppearance(input: {
  root: string;
  stop: { since: string; reason: string | null } | null;
  at: string;
}): Promise<void> {
  const current = await readHealthAppearance(input.root);
  const state: HealthAppearanceState = current ?? {
    schemaVersion: 1,
    recordingSince: input.at,
    stops: [],
  };
  // A stop that began before recording may have appeared earlier, so its time stays unknown.
  const known =
    input.stop === null ||
    Date.parse(input.stop.since) < Date.parse(state.recordingSince) ||
    state.stops.some((stop) => stop.since === input.stop!.since);
  if (current !== null && known) return;
  if (!known)
    state.stops = [
      ...state.stops,
      { since: input.stop!.since, reason: input.stop!.reason, firstPreparedAt: input.at },
    ]
      .sort((left, right) => right.since.localeCompare(left.since))
      .slice(0, MAXIMUM_STOPS);
  await writeHealthAppearance(input.root, state);
}
