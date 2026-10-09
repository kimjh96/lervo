import { sha256 } from "./integrity.js";
import type { StoredConcept } from "./store-reader.js";

const BUILD = "concept-sidecar-v1+yaml-2.9.0";
const fields = new Set([
  "schemaVersion",
  "conceptId",
  "title",
  "path",
  "ownership",
  "publicationStatus",
  "publicationLanguage",
  "freshness",
  "sourceUnitVersionIds",
  "assurance",
]);

/** Reuses decoding only. The reader still reads current bytes and validates every concept. */
export class ConceptSidecarCache {
  private readonly previous = new Map<string, unknown>();
  private readonly current = new Map<string, unknown>();
  private changed = false;
  readonly statistics = { reused: 0, decoded: 0 };

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
        !/^sha256:[a-f0-9]{64}$/u.test(entry[0]) ||
        this.previous.has(entry[0]) ||
        entry[1] === null ||
        typeof entry[1] !== "object" ||
        Array.isArray(entry[1])
      ) {
        this.previous.clear();
        this.changed = true;
        return;
      }
      this.previous.set(entry[0], entry[1]);
    }
  }

  decode(
    file: string,
    bytes: string,
    parseAndValidate: (value?: unknown) => StoredConcept,
  ): StoredConcept {
    const key = sha256(JSON.stringify([file, sha256(bytes)]));
    if (this.previous.has(key)) {
      try {
        const value = parseAndValidate(structuredClone(this.previous.get(key)));
        this.current.set(key, this.previous.get(key));
        this.statistics.reused++;
        return value;
      } catch {
        // Invalid projected values must be reconstructed from the already-read canonical bytes.
      }
    }
    const value = parseAndValidate();
    this.statistics.decoded++;
    this.changed = true;
    // Unknown YAML fields can contain cycles or non-JSON values. Preserve them through fresh
    // decoding instead of changing their representation to make them cacheable.
    if (Object.keys(value).every((field) => fields.has(field)))
      this.current.set(key, structuredClone(value));
    return value;
  }

  snapshot(): unknown | null {
    if (!this.changed && this.current.size === this.previous.size) return null;
    return {
      build: BUILD,
      entries: [...this.current].sort(([left], [right]) => left.localeCompare(right)),
    };
  }
}
