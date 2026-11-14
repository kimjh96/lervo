import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { captureConvergenceSources, type ConvergenceSourceCapture } from "../src/source-capture.js";
import type { ConvergenceSourceObservation } from "../src/source-observation.js";

/** The `src/` frame that asked for a capture, named by file and line. */
function observationSite(): string {
  for (const frame of (new Error().stack ?? "").split("\n").slice(1)) {
    const match = /repository-knowledge-runtime\/src\/([\w-]+\.ts):(\d+)/u.exec(frame);
    if (match === null || match[1] === "source-observation.ts") continue;
    // The assertion helpers sit between every check and its caller; host methods name their own.
    if (/assertObservedSource|assertConvergenceSource|assertSource(Exact|Current)/u.test(frame))
      continue;
    if (
      match[1] === "host.ts" &&
      !/\.(assertSettlement|assertCurrent|prepareStage|runStage) /u.test(frame)
    )
      continue;
    return `${match[1]}:${match[2]}`;
  }
  return "unknown";
}

/**
 * Repository state an effect could change: HEAD, every ref, every captured source except the
 * mutated one, and the private candidate stores that effect sites write.
 */
export function effectObservableState(root: string, mutatedPath: string): string {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  const candidates: string[] = [];
  const knowledge = resolve(root, ".lervo/state/knowledge");
  const walk = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile())
        candidates.push(
          `${path.slice(knowledge.length)}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`,
        );
    }
  };
  if (existsSync(knowledge))
    for (const entry of readdirSync(knowledge))
      if (entry.endsWith("candidates") && statSync(resolve(knowledge, entry)).isDirectory())
        walk(resolve(knowledge, entry));
  return JSON.stringify({
    head: git("rev-parse", "HEAD"),
    refs: git("for-each-ref", "--format=%(refname) %(objectname)"),
    sources: captureConvergenceSources(root, "effect-state")
      .sources.filter((source) => source.path !== mutatedPath)
      .map((source) => `${source.path}:${source.contentHash}`),
    candidates: candidates.sort(),
  });
}

export interface LyingObservationTrace {
  /** Exact captures in call order, by the site that asked. */
  exactSites: string[];
  /** Distinct sites whose decision checks the session answered. */
  currentSites: string[];
  noteChanges: number;
}

/**
 * A session whose validation always answers "unchanged": `current` returns the last capture without
 * looking at the repository, so it never notices another writer. It honours `noteChange`, as the
 * session does for this process's own effects. `exact` stays a complete capture, so only exact
 * fences can refuse. `beforeExact` and `beforeCurrent` may mutate the repository first.
 */
export function lyingSourceObservation(
  root: string,
  hooks: {
    beforeExact?(site: string, trace: LyingObservationTrace): void;
    beforeCurrent?(site: string, trace: LyingObservationTrace): void;
    onObservation?(kind: "exact" | "current" | "note_change", trace: LyingObservationTrace): void;
  } = {},
): ConvergenceSourceObservation & { trace: LyingObservationTrace } {
  const trace: LyingObservationTrace = { exactSites: [], currentSites: [], noteChanges: 0 };
  const last = new Map<string, ConvergenceSourceCapture>();
  const capture = (policyHash: string) => {
    const captured = captureConvergenceSources(root, policyHash);
    last.set(policyHash, captured);
    return captured;
  };
  return {
    trace,
    exact(policyHash) {
      hooks.onObservation?.("exact", trace);
      const site = observationSite();
      hooks.beforeExact?.(site, trace);
      trace.exactSites.push(site);
      return capture(policyHash);
    },
    current(policyHash) {
      hooks.onObservation?.("current", trace);
      const site = observationSite();
      if (!trace.currentSites.includes(site)) trace.currentSites.push(site);
      hooks.beforeCurrent?.(site, trace);
      return last.get(policyHash) ?? capture(policyHash);
    },
    noteChange() {
      hooks.onObservation?.("note_change", trace);
      trace.noteChanges += 1;
      last.clear();
    },
  };
}
