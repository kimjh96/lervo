import {
  canonicalJson,
  practicePublicPath,
  sanitizePracticeText,
} from "@lervo/repository-knowledge";
import { repositoryPathWithinScope } from "@lervo/work-controller";
import type { PracticeWorkRecord } from "./practice-state.js";

/** Every assessment uses the same bounded read-scope projection, including the timer path. */
export function disclosePracticeWork(
  work: PracticeWorkRecord,
  roots: string[],
  readablePaths?: string[],
): PracticeWorkRecord {
  const allowed = (path: string) =>
    practicePublicPath(path) &&
    (readablePaths === undefined || readablePaths.includes(path)) &&
    roots.some((r) => repositoryPathWithinScope(path, r));
  const denied = [
    ...new Set([...work.changedFiles.map((f) => f.path), ...work.steps.flatMap((s) => s.paths)]),
  ].filter((p) => !allowed(p));
  const result = {
    ...work,
    changedFiles: work.changedFiles.filter((f) => allowed(f.path)),
    steps: work.steps.map((s) => ({ ...s, paths: s.paths.filter(allowed) })),
    reply: sanitizePracticeText(work.reply)
      .split("\n")
      .filter((line) => !denied.some((p) => line.includes(p)))
      .join("\n"),
  };
  if (Buffer.byteLength(canonicalJson(result)) > 24 * 1024) throw new Error("source_incomplete");
  return result;
}
