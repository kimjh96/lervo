import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

export const RESIDENT_CYCLE_STATE_PATH = ".lervo/state/knowledge/resident-cycle.json";

export type ResidentCycleResult = "idle" | "waiting" | "attention" | "processed" | "failed";

/** Private rebuildable fence state: digests and timestamps only, never document currency. */
export interface ResidentCycleState {
  schemaVersion: 1;
  fingerprint: string | null;
  lastCycleAt: string | null;
  lastResult: ResidentCycleResult;
  idleStreak: number;
  nextReconcileAt: string | null;
}

const RESULTS = new Set<string>(["idle", "waiting", "attention", "processed", "failed"]);
const HASH = /^sha256:[a-f0-9]{64}$/u;

function timestamp(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

/** Missing, unreadable or invalid state yields null, so the next cycle runs in full. */
export async function readResidentCycleState(root: string): Promise<ResidentCycleState | null> {
  try {
    const path = resolve(root, RESIDENT_CYCLE_STATE_PATH);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > 4_096) return null;
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<ResidentCycleState>;
    if (
      value?.schemaVersion !== 1 ||
      !(
        value.fingerprint === null ||
        (typeof value.fingerprint === "string" && HASH.test(value.fingerprint))
      ) ||
      !timestamp(value.lastCycleAt) ||
      !timestamp(value.nextReconcileAt) ||
      typeof value.lastResult !== "string" ||
      !RESULTS.has(value.lastResult) ||
      !Number.isSafeInteger(value.idleStreak) ||
      value.idleStreak! < 0
    )
      return null;
    return value as ResidentCycleState;
  } catch {
    return null;
  }
}

export async function writeResidentCycleState(
  root: string,
  state: ResidentCycleState,
): Promise<void> {
  let directory = resolve(root);
  for (const part of [".lervo", "state", "knowledge"]) {
    directory = resolve(directory, part);
    await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Resident cycle state directory is invalid.");
  }
  const temporary = resolve(directory, `.resident-cycle-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, resolve(root, RESIDENT_CYCLE_STATE_PATH));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
