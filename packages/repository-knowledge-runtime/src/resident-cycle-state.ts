import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";

import { RESIDENT_FAILURE_CODE } from "./resident-cycle-failure.js";

export const RESIDENT_CYCLE_STATE_PATH = ".lervo/state/knowledge/resident-cycle.json";

/** `held`: the owner holds the repository (ADR-0561), so the cycle applied nothing and backs off. */
export type ResidentCycleResult =
  "idle" | "waiting" | "attention" | "held" | "processed" | "failed";

export interface ResidentCycleFailure {
  code: string;
  detail: string | null;
  at: string;
}

/** Private rebuildable fence and bounded failure diagnostic, never document currency. */
export interface ResidentCycleState {
  schemaVersion: 1;
  fingerprint: string | null;
  lastCycleAt: string | null;
  lastResult: ResidentCycleResult;
  idleStreak: number;
  nextReconcileAt: string | null;
  lastFailure?: ResidentCycleFailure | null;
}

const RESULTS = new Set<string>(["idle", "waiting", "attention", "held", "processed", "failed"]);
const HASH = /^sha256:[a-f0-9]{64}$/u;

function timestamp(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function failure(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<ResidentCycleFailure>;
  return (
    typeof item.code === "string" &&
    RESIDENT_FAILURE_CODE.test(item.code) &&
    (item.detail === null ||
      (typeof item.detail === "string" &&
        item.detail.length <= 300 &&
        !/[\r\n\0]/u.test(item.detail))) &&
    typeof item.at === "string" &&
    timestamp(item.at)
  );
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
      value.idleStreak! < 0 ||
      !failure(value.lastFailure)
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
  const content = `${JSON.stringify(state)}\n`;
  if (Buffer.byteLength(content) > 4_096) throw new Error("Resident cycle state exceeds 4 KiB.");
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
    await writeFile(temporary, content, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, resolve(root, RESIDENT_CYCLE_STATE_PATH));
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
