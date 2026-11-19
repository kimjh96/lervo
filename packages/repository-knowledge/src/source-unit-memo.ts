import { sha256 } from "./integrity.js";
import {
  extractUnitsWithOutcome,
  REPOSITORY_SOURCE_UNIT_BUILD,
} from "./repository-source-units.js";
import {
  packSourceUnits,
  unpackSourceUnits,
  type PackedSourceUnit,
  type ReadableSource,
} from "./source-unit-cache-codec.js";
import type { RepositorySourceUnit } from "./types.js";

/**
 * Process-wide reuse of complete unit extractions for scans that carry no `SourceUnitCache`. The
 * resident scans every registered repository for lint, layout, normalization and health, and
 * without it re-parsed every unchanged JavaScript and TypeScript file on each scan: a profile of
 * the Mac knowledge host spent most of 27 busy seconds in 40 inside `extractUnits` (core-loop
 * item 6).
 *
 * Each project keeps the extractions its latest scans used, as `SourceUnitCache` does on disk: a
 * scan reads from the previous working set and records its own, so one repository never evicts
 * another and a repeating sweep always hits. The key binds the exact bytes and every input
 * extraction reads, so a hit returns the units a fresh extraction would. Only complete extractions
 * are kept.
 */
interface ProjectWorkingSet {
  previous: Map<string, PackedSourceUnit[]>;
  current: Map<string, PackedSourceUnit[]>;
}

const projects = new Map<string, ProjectWorkingSet>();
const build = sha256(JSON.stringify(REPOSITORY_SOURCE_UNIT_BUILD));

/** Starts one scan of a project and returns its extractor. */
export function beginMemoizedSourceUnits(
  projectId: string,
  failureMode: "fail" | "file_only" | undefined,
): (source: ReadableSource) => RepositorySourceUnit[] {
  const known = projects.get(projectId);
  // The previous working set is what the latest complete scan used. A scan that began while
  // another one of the same project was still running (lint and layout run together) has recorded
  // only part of its set, so the earlier set is kept with it; versions no scan uses are dropped.
  const previous =
    known === undefined
      ? new Map<string, PackedSourceUnit[]>()
      : known.current.size * 2 >= known.previous.size
        ? new Map(known.current)
        : new Map([...known.previous, ...known.current]);
  const set: ProjectWorkingSet = { previous, current: new Map() };
  projects.set(projectId, set);
  return (source) => {
    if (source.classification !== "ordinary" || source.kind === "revision_metadata")
      return extractUnitsWithOutcome(projectId, source, failureMode).units;
    const key = sha256(
      JSON.stringify([
        build,
        failureMode ?? "fail",
        source.sourceId,
        source.path,
        source.identityPath ?? null,
        source.kind,
        source.contentHash,
        source.byteCount,
      ]),
    );
    const cached = set.current.get(key) ?? set.previous.get(key);
    if (cached !== undefined) {
      set.current.set(key, cached);
      return unpackSourceUnits(source, cached);
    }
    const { units, complete } = extractUnitsWithOutcome(projectId, source, failureMode);
    if (complete) set.current.set(key, packSourceUnits(units));
    return units;
  };
}

/** Test seam: the number of extractions a project keeps, and a way to forget all of them. */
export function memoizedSourceCount(projectId: string): number {
  const set = projects.get(projectId);
  return set === undefined ? 0 : new Set([...set.previous.keys(), ...set.current.keys()]).size;
}

export function clearSourceUnitMemo(): void {
  projects.clear();
}
