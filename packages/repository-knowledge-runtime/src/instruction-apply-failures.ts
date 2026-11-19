import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Private, rebuildable record of why stored owner rules were not applied yet. Before it existed,
 * every failure was swallowed as `deferred`, and two rules waited 7 and 18 days unseen.
 */
export const INSTRUCTION_APPLY_FAILURES_PATH =
  ".lervo/state/knowledge/instruction-apply-failures.json";

export interface InstructionApplyFailure {
  /** The error's `code`, or `instruction_apply_failed` when it has none. */
  code: string;
  firstFailedAt: string;
  lastFailedAt: string;
  attempts: number;
}

interface InstructionApplyFailureFile {
  schemaVersion: 1;
  failures: Record<string, InstructionApplyFailure>;
}

const MAXIMUM_FAILURES = 64;
const CANDIDATE = /^kinstruction_[a-f0-9]{24}$/u;
const CODE = /^[a-z][a-z0-9_]{0,63}$/u;

/** A stable, path-free failure code for an apply error. */
export function instructionApplyFailureCode(error: unknown): string {
  const code =
    error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
  return typeof code === "string" && CODE.test(code) ? code : "instruction_apply_failed";
}

/** Missing or invalid records read as none; they only explain a delay, never decide anything. */
export async function readInstructionApplyFailures(
  root: string,
): Promise<Map<string, InstructionApplyFailure>> {
  try {
    const path = resolve(root, INSTRUCTION_APPLY_FAILURES_PATH);
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > 32_768) return new Map();
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<InstructionApplyFailureFile>;
    if (value?.schemaVersion !== 1 || value.failures === null || typeof value.failures !== "object")
      return new Map();
    return new Map(
      Object.entries(value.failures).filter(
        ([candidateId, failure]) =>
          CANDIDATE.test(candidateId) &&
          typeof failure?.code === "string" &&
          CODE.test(failure.code) &&
          Number.isSafeInteger(failure.attempts) &&
          Number.isFinite(Date.parse(failure.firstFailedAt)) &&
          Number.isFinite(Date.parse(failure.lastFailedAt)),
      ),
    );
  } catch {
    return new Map();
  }
}

/**
 * Replaces the records with this cycle's outcome: a failed candidate keeps its first failure time
 * and counts attempts, an applied or vanished candidate drops out. At most 64 records are kept.
 */
export async function writeInstructionApplyFailures(
  root: string,
  failures: ReadonlyMap<string, InstructionApplyFailure>,
): Promise<void> {
  let directory = resolve(root);
  for (const part of [".lervo", "state", "knowledge"]) {
    directory = resolve(directory, part);
    await mkdir(directory, { mode: 0o700 }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "EEXIST") throw error;
    });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Instruction apply failure directory is invalid.");
  }
  const target = resolve(root, INSTRUCTION_APPLY_FAILURES_PATH);
  if (failures.size === 0) {
    await rm(target, { force: true });
    return;
  }
  const kept = [...failures]
    .sort(([, left], [, right]) => right.lastFailedAt.localeCompare(left.lastFailedAt))
    .slice(0, MAXIMUM_FAILURES);
  const file: InstructionApplyFailureFile = {
    schemaVersion: 1,
    failures: Object.fromEntries(kept),
  };
  const temporary = resolve(directory, `.instruction-apply-failures-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, `${JSON.stringify(file)}\n`, { mode: 0o600, flag: "wx" });
    await chmod(temporary, 0o600);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/** The next record for a candidate that failed again. */
export function nextInstructionApplyFailure(
  previous: InstructionApplyFailure | undefined,
  code: string,
  at: string,
): InstructionApplyFailure {
  return {
    code,
    firstFailedAt: previous?.firstFailedAt ?? at,
    lastFailedAt: at,
    attempts: Math.min((previous?.attempts ?? 0) + 1, 1_000_000),
  };
}
