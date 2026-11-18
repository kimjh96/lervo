import { constants } from "node:fs";
import { open, type FileHandle } from "node:fs/promises";
import type { ReferenceReadBudget } from "./cas-retention-budget.js";
import { referenceFile, type CasReferenceFile } from "./cas-retention-files.js";
import {
  convergenceRecordShape,
  type ConvergenceRecordShapes,
} from "./cas-retention-record-shapes.js";
import type { SupersededLifecycle } from "./cas-retention-superseded.js";

const MIB = 1024 * 1024;
/** A larger body stays protected unread; the largest observed stage result is 5.6 MB. */
const MAXIMUM_RECORD_BYTES = 32 * MIB;
/** Only small objects are probed as observations; the largest observed one is 38 KB. */
const MAXIMUM_OBSERVATION_BYTES = MIB;
/** `canonicalJson` sorts keys, so every provider stage observation starts with this field. */
const OBSERVATION_PREFIX = Buffer.from('{"admissionObservationHash":', "latin1");

/** Null when the file changed or vanished since the inventory; the next pass reads it again. */
async function readBody(file: CasReferenceFile, length: number): Promise<Uint8Array | null> {
  let handle: FileHandle | null = null;
  try {
    handle = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    if ((await referenceFile(file.path, file.hash)).identity !== file.identity) return null;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return bytesRead === length ? buffer : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === "ENOENT") return null;
    throw error;
  } finally {
    await handle?.close();
  }
}

/**
 * Records the shape of each object that could be a superseded record, within the cycle's read
 * budget, and caches it by digest. Candidates are an object that a superseded assignment's
 * `assignment.completed` names and, while any assignment is superseded, any small object past
 * grace that starts like a provider stage observation, since no record names those. `complete`
 * is false when the budget ran out first.
 */
export async function classifyConvergenceRecords(input: {
  files: readonly CasReferenceFile[];
  lifecycle: SupersededLifecycle;
  candidates: ReadonlyMap<string, number>;
  before: number;
  shapes: ConvergenceRecordShapes;
  budget: ReferenceReadBudget;
}): Promise<{ complete: boolean; changed: boolean }> {
  const { lifecycle, shapes, budget } = input;
  let changed = false;
  const read = async (file: CasReferenceFile, length: number) =>
    budget.read(
      () => readBody(file, length),
      (body) => body?.byteLength ?? 0,
    );
  for (const file of input.files) {
    const hash = file.hash;
    if (hash === null || file.modifiedAt >= input.before) continue;
    const completion = lifecycle.completions.has(hash);
    if (completion) {
      if (
        (hash in shapes && shapes[hash] !== "no_observation_prefix") ||
        (lifecycle.namedAt.get(hash) ?? 0) >= input.before
      )
        continue;
    } else if (
      hash in shapes ||
      lifecycle.assignments.size === 0 ||
      input.candidates.has(hash) ||
      file.size > MAXIMUM_OBSERVATION_BYTES
    )
      continue;
    if (file.size > MAXIMUM_RECORD_BYTES) {
      shapes[hash] = null;
      changed = true;
      continue;
    }
    if (!completion) {
      if (await budget.exhausted(OBSERVATION_PREFIX.length)) return { complete: false, changed };
      const prefix = await read(file, Math.min(file.size, OBSERVATION_PREFIX.length));
      if (prefix === null) continue;
      if (!OBSERVATION_PREFIX.equals(prefix)) {
        shapes[hash] = "no_observation_prefix";
        changed = true;
        continue;
      }
    }
    if (await budget.exhausted(Math.max(1, file.size))) return { complete: false, changed };
    const body = await read(file, file.size);
    if (body === null) continue;
    shapes[hash] = convergenceRecordShape(hash, body);
    changed = true;
  }
  return { complete: true, changed };
}
