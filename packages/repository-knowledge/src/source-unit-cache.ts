import { canonicalJson, sha256 } from "./integrity.js";
import {
  extractUnits,
  extractUnitsWithOutcome,
  REPOSITORY_SOURCE_UNIT_BUILD,
} from "./repository-source-units.js";
import {
  packSourceUnits,
  unpackSourceUnits,
  validPackedUnits,
  type PackedSourceUnit,
  type ReadableSource,
} from "./source-unit-cache-codec.js";
import type { RepositoryKnowledgePolicy, RepositorySourceUnit } from "./types.js";

interface ScanCoordinates {
  projectId: string;
  policy: RepositoryKnowledgePolicy;
  sourceUnitFailureMode?: "fail" | "file_only";
}

interface SourceUnitCacheSnapshot {
  schemaVersion: 1;
  binding: string;
  entries: Array<[key: string, units: PackedSourceUnit[]]>;
}

/** One preparation owns this projection. It never supplies source bytes or admission decisions. */
export class SourceUnitCache {
  private binding = "";
  private previous = new Map<string, PackedSourceUnit[]>();
  private current = new Map<string, PackedSourceUnit[]>();
  private changed = false;
  readonly statistics = {
    reusedSources: 0,
    recomputedSources: 0,
    reusedUnits: 0,
    recomputedUnits: 0,
  };

  constructor(private loaded: unknown = null) {}

  begin(input: ScanCoordinates): (source: ReadableSource) => RepositorySourceUnit[] {
    this.binding = sha256(
      canonicalJson({
        projectId: input.projectId,
        policy: input.policy,
        build: REPOSITORY_SOURCE_UNIT_BUILD,
      }),
    );
    this.previous = new Map();
    this.current = new Map();
    this.changed = false;
    Object.assign(this.statistics, {
      reusedSources: 0,
      recomputedSources: 0,
      reusedUnits: 0,
      recomputedUnits: 0,
    });
    const stored = this.loaded as Partial<SourceUnitCacheSnapshot> | null;
    this.changed = stored?.schemaVersion !== 1 || stored.binding !== this.binding;
    if (
      stored?.schemaVersion === 1 &&
      stored.binding === this.binding &&
      Array.isArray(stored.entries)
    ) {
      for (const entry of stored.entries) {
        if (
          !Array.isArray(entry) ||
          entry.length !== 2 ||
          typeof entry[0] !== "string" ||
          !/^sha256:[a-f0-9]{64}$/u.test(entry[0]) ||
          this.previous.has(entry[0]) ||
          !validPackedUnits(entry[1])
        ) {
          this.previous.clear();
          this.changed = true;
          break;
        }
        this.previous.set(entry[0], entry[1]);
      }
    }
    return (source) => {
      if (source.classification !== "ordinary" || source.kind === "revision_metadata") {
        return extractUnits(input.projectId, source, input.sourceUnitFailureMode);
      }
      const key = sha256(
        JSON.stringify([
          source.sourceId,
          source.path,
          source.identityPath ?? null,
          source.kind,
          source.contentHash,
          source.byteCount,
        ]),
      );
      const cached = this.previous.get(key);
      if (cached !== undefined && cached.every((item) => item[6] <= source.byteCount)) {
        this.current.set(key, cached);
        this.statistics.reusedSources++;
        this.statistics.reusedUnits += cached.length;
        return unpackSourceUnits(source, cached);
      }
      const { units, complete } = extractUnitsWithOutcome(
        input.projectId,
        source,
        input.sourceUnitFailureMode,
      );
      // A successful extraction is identical in strict and file-only mode. A fallback is never
      // cached, so switching back to strict mode still parses and rejects invalid source bytes.
      if (complete) {
        this.current.set(key, packSourceUnits(units));
        this.changed = true;
      }
      this.statistics.recomputedSources++;
      this.statistics.recomputedUnits += units.length;
      return units;
    };
  }

  /** Only the successful scan's inventory survives; unchanged observations cause no disk write. */
  snapshot(): SourceUnitCacheSnapshot | null {
    if (!this.changed && this.current.size === this.previous.size) return null;
    return { schemaVersion: 1, binding: this.binding, entries: [...this.current] };
  }

  release(): void {
    this.loaded = null;
    this.previous.clear();
    this.current.clear();
  }
}
