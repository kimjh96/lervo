import { readPrivateStateJson, writePrivateStateJson } from "./private-state-file.js";

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
  /** The newest start time dropped by the 64-stop bound; stops at or before it are unknown. */
  prunedThrough?: string | null;
  stops: HealthStopAppearance[];
}

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
    (state.prunedThrough === undefined ||
      state.prunedThrough === null ||
      isTime(state.prunedThrough)) &&
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
  const value = await readPrivateStateJson(root, FILE, MAXIMUM_BYTES);
  return valid(value) ? value : null;
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
  if (!known) {
    const ordered = [
      ...state.stops,
      { since: input.stop!.since, reason: input.stop!.reason, firstPreparedAt: input.at },
    ].sort((left, right) => Date.parse(right.since) - Date.parse(left.since));
    state.stops = ordered.slice(0, MAXIMUM_STOPS);
    const pruned = ordered[MAXIMUM_STOPS];
    if (pruned !== undefined) state.prunedThrough = pruned.since;
  }
  await writePrivateStateJson(input.root, FILE, state);
}
