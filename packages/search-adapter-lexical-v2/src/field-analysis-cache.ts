import { canonicalHash } from "@lervo/search";

import {
  analyzeLexicalV2Field,
  normalizeLexicalV2Field,
  type LexicalV2FieldName,
  type LexicalV2IndexedField,
} from "./features.js";

type Frequencies = ReadonlyMap<string, number>;
type Analysis = [exact: Frequencies, identifiers: Frequencies];
const BUILD = "lexical-v2-field-analysis-v2";

function validFrequencies(value: unknown): value is Frequencies {
  if (!(value instanceof Map)) return false;
  for (const [term, count] of value) {
    if (typeof term !== "string" || term.length === 0 || !Number.isSafeInteger(count) || count < 1)
      return false;
  }
  return true;
}

/** Input-bound token frequencies only; normalized document bodies are never persisted. */
export class LexicalV2FieldAnalysisCache {
  private readonly previous = new Map<string, unknown>();
  private readonly current = new Map<string, Analysis>();
  private changed = false;
  readonly statistics = { reusedFields: 0, analyzedFields: 0 };

  constructor(loaded: unknown = null) {
    const snapshot = loaded as { build?: unknown; entries?: unknown } | null;
    if (snapshot?.build !== BUILD || !Array.isArray(snapshot.entries)) {
      this.changed = true;
      return;
    }
    for (const entry of snapshot.entries) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== "string" ||
        this.previous.has(entry[0])
      ) {
        this.previous.clear();
        this.changed = true;
        return;
      }
      this.previous.set(entry[0], entry[1]);
    }
  }

  analyze(name: LexicalV2FieldName, value: string, weight: number): LexicalV2IndexedField | null {
    if (value.length === 0) return null;
    const key = canonicalHash({ name, value, weight });
    const previous = this.current.get(key) ?? this.previous.get(key);
    if (
      Array.isArray(previous) &&
      previous.length === 2 &&
      validFrequencies(previous[0]) &&
      validFrequencies(previous[1])
    ) {
      const analysis: Analysis = [previous[0], previous[1]];
      this.current.set(key, analysis);
      this.statistics.reusedFields++;
      return {
        name,
        weight,
        normalized: normalizeLexicalV2Field(value),
        exactFrequencies: analysis[0],
        identifierFrequencies: analysis[1],
      };
    }
    const field = analyzeLexicalV2Field(name, value, weight)!;
    this.current.set(key, [field.exactFrequencies, field.identifierFrequencies]);
    this.changed = true;
    this.statistics.analyzedFields++;
    return field;
  }

  snapshot(): unknown | null {
    if (!this.changed && this.current.size === this.previous.size) return null;
    return { build: BUILD, entries: [...this.current] };
  }
}
