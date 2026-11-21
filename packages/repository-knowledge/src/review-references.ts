import { providerReferenceEnum } from "@lervo/schemas";

/**
 * ADR-0604: the short references a provider answer cites in place of identifiers and hashes. The
 * provider sees `<prefix><n>` (`s1`, `c2`, `d1.u3`) for each item it may cite, the response schema
 * allows only those references, and the parser maps each one back to its exact item. A provider
 * therefore never copies a hash or an opaque identifier, so it can never garble one.
 *
 * Where an item has a path, the answer names the path next to the reference and `resolve` requires
 * both to name the same item, so a valid reference to the wrong item is rejected as well.
 */
export interface ReviewReferenceSet<T> {
  /** The references in item order. */
  readonly references: readonly string[];
  /** The items in the same order. */
  readonly items: readonly T[];
  /** The reference that stands for the item at `index`. */
  reference(index: number): string;
  /** The reference that stands for `item` (by identity), or undefined. */
  referenceOf(item: T): string | undefined;
  /** `{ enum }` of the references, or null when there is none: an empty `enum` is never emitted. */
  readonly schema: { enum: string[] } | null;
  /** `{ enum }` of the distinct item paths, or null when the set is empty or has no paths. */
  readonly pathSchema: { enum: string[] } | null;
  /**
   * The item a reference names. When the set has paths, `path` must be that item's path. Returns
   * undefined for anything else, so the caller rejects the answer with its own error.
   */
  resolve(reference: unknown, path?: unknown): T | undefined;
}

export function reviewReferences<T>(
  items: readonly T[],
  options: {
    prefix: string;
    path?: (item: T) => string;
    /** ADR-0608: what the paired value is: a repository `path` by default, or a text `anchor`. */
    pathKind?: "path" | "anchor";
  },
): ReviewReferenceSet<T> {
  const references = items.map((_, index) => `${options.prefix}${index + 1}`);
  const byReference = new Map(references.map((reference, index) => [reference, items[index]!]));
  const byItem = new Map(items.map((item, index) => [item, references[index]!]));
  const pathOf = options.path;
  const paths = pathOf === undefined ? [] : [...new Set(items.map((item) => pathOf(item)))];
  return {
    references,
    items,
    reference: (index) => {
      const reference = references[index];
      if (reference === undefined) throw new RangeError("No review reference at this index.");
      return reference;
    },
    referenceOf: (item) => byItem.get(item),
    schema: references.length === 0 ? null : providerReferenceEnum(references, "reference"),
    pathSchema:
      paths.length === 0 ? null : providerReferenceEnum(paths, options.pathKind ?? "path"),
    resolve: (reference, path) => {
      if (typeof reference !== "string") return undefined;
      const item = byReference.get(reference);
      if (item === undefined) return undefined;
      if (pathOf !== undefined && pathOf(item) !== path) return undefined;
      return item;
    },
  };
}

/** ADR-0604: a reference field that may be null; only `null` is allowed when nothing can be cited. */
export function nullableReviewEnum(values: readonly string[]): Record<string, unknown> {
  return values.length === 0
    ? { type: "null" }
    : { type: ["string", "null"], enum: [...new Set(values), null] };
}

/**
 * ADR-0604: an array whose items cite references. With nothing to cite the array must stay empty;
 * its schema then says `maxItems: 0` and the parser enforces it, because some providers drop
 * `maxItems` and an empty `enum` is never emitted.
 */
export function referencingArraySchema(
  item: Record<string, unknown> | null,
  bounds: { minItems?: number; maxItems?: number } = {},
): Record<string, unknown> {
  if (item === null) return { type: "array", maxItems: 0, items: { type: "null" } };
  return { type: "array", ...bounds, items: item };
}

/** ADR-0604: a provider answer that breaks its review contract; it is never cached or applied. */
export class ReviewAnswerInvalidError extends Error {
  readonly code = "knowledge_semantic_review_invalid";
  constructor(detail: string) {
    super(`The provider answer breaks its review contract: ${detail}.`);
    this.name = "ReviewAnswerInvalidError";
  }
}
