import { chmod, lstat, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { readPrivateJsonFile, writePrivateJsonFile } from "./private-state-file.js";
import { practiceFunnel, type PracticeState } from "./practice-state.js";

export const PRACTICE_ROOT = ".lervo/state/knowledge/practice";
const DAY = 86_400_000;

async function assertPrivateParents(root: string): Promise<void> {
  let path = resolve(root);
  for (const part of PRACTICE_ROOT.split("/")) {
    path = resolve(path, part);
    const stat = await lstat(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (stat === null) return;
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Unsafe practice state directory.");
  }
}

export async function readPracticeState(root: string): Promise<PracticeState> {
  await assertPrivateParents(root);
  const result = await readPrivateJsonFile(
    resolve(root, PRACTICE_ROOT, "state.json"),
    16 * 1024 * 1024,
  );
  if (result.status === "invalid") throw new Error("Invalid private practice state.");
  if (result.status === "read") {
    const value = result.value as PracticeState;
    if (
      value.schemaVersion !== 1 ||
      ![
        value.works,
        value.evidence,
        value.candidates,
        value.generated,
        value.shapes,
        value.assessed,
        value.funnel,
      ].every(Array.isArray)
    )
      throw new Error("Invalid private practice state.");
    return value;
  }
  return {
    schemaVersion: 1,
    works: [],
    evidence: [],
    candidates: [],
    generated: [],
    shapes: [],
    assessed: [],
    funnel: [],
  };
}

export function compactPracticeState(state: PracticeState, now: Date): void {
  const age = (at: string) => now.getTime() - Date.parse(at);
  for (const candidate of state.candidates) {
    if (
      age(candidate.observedAt) >= 7 * DAY &&
      ["assessed", "unresolved", "drafted", "reviewed_accepted"].includes(candidate.state) &&
      !candidate.commit
    ) {
      candidate.state = "reviewed_rejected";
      candidate.reason = "assessment_expired";
      practiceFunnel(state, now, "accepted", "assessment_expired");
    }
  }
  const retained = new Set(
    state.candidates
      .filter(
        (c) =>
          ![
            "reviewed_rejected",
            "reviewed_accepted",
            "materialized",
            "published",
            "exposed",
            "used",
            "retired",
          ].includes(c.state),
      )
      .flatMap((c) => c.workDigests),
  );
  state.works = state.works
    .filter(
      (w) =>
        age(w.observedAt) < 7 * DAY &&
        (!state.assessed.some((a) => a.workDigest === w.workDigest) || retained.has(w.workDigest)),
    )
    .slice(-128);
  state.evidence = state.evidence
    .filter((e) => retained.has(e.work.workDigest) && age(e.work.observedAt) < 7 * DAY)
    .slice(-64);
  state.shapes = state.shapes.filter((s) => age(s.observedAt) < 30 * DAY).slice(-2048);
  state.assessed = state.assessed.filter((a) => age(a.at) < 8 * DAY).slice(-1024);
  state.candidates = state.candidates
    .filter(
      (c) =>
        age(c.observedAt) < 90 * DAY ||
        retained.has(c.workDigests[0]!) ||
        state.generated.some((g) => g.candidateId === c.candidateId),
    )
    .slice(-1024);
  state.funnel = state.funnel.filter((row) => age(`${row.day}T00:00:00Z`) < 32 * DAY).slice(-32);
  if (state.generated.length > 1024) throw new Error("Practice skill registry is full.");
}

export async function writePracticeState(
  root: string,
  state: PracticeState,
  now: Date,
): Promise<void> {
  compactPracticeState(state, now);
  let path = resolve(root);
  for (const part of PRACTICE_ROOT.split("/")) {
    path = resolve(path, part);
    await mkdir(path, { mode: 0o700 }).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "EEXIST") throw e;
    });
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("Unsafe practice state directory.");
    await chmod(path, 0o700);
  }
  if (Buffer.byteLength(JSON.stringify(state)) > 16 * 1024 * 1024)
    throw new Error("Practice state exceeds its bound.");
  const target = resolve(root, PRACTICE_ROOT, "state.json");
  const previous = await readPrivateJsonFile(target, 16 * 1024 * 1024);
  if (previous.status === "read" && JSON.stringify(previous.value) === JSON.stringify(state))
    return;
  await writePrivateJsonFile(target, state);
}
