/**
 * ADR-0608: the one way to build a JSON schema a provider answers in. A model asked to copy a
 * hash, digest or identifier back garbles some, so no provider output may name one or offer one
 * as a value; Lervo binds those itself. `providerOutputSchema` checks the schema it is given,
 * whatever built it, and brands it: every provider boundary accepts only a `ProviderOutputSchema`,
 * so TypeScript refuses any other. `assertProviderOutputSchemaForSource` checks it again against
 * the exact source data a call sends, where the schema leaves for a provider.
 */

/**
 * A schema `providerOutputSchema` checked; the only kind a provider boundary accepts. The brand is
 * a type-only property no value carries: only the helper's cast gives it, and the provider schema
 * scan refuses the key anywhere else.
 */
export type ProviderOutputSchema = Readonly<Record<string, unknown>> & {
  readonly __providerOutputSchema: true;
};

/**
 * One request to a no-capability provider. Its response schema must come from
 * `providerOutputSchema`, so TypeScript refuses any other; the runner checks it again against the
 * request's own data before it leaves.
 */
export interface ProviderJsonRequest {
  responseContract: {
    schemaVersion?: number;
    schema: ProviderOutputSchema;
    [field: string]: unknown;
  };
  [field: string]: unknown;
}

/** Words that name a value a model would copy back, as the last word of a property name. */
const COPIED_WORDS = new Set([
  "hash",
  "digest",
  "sha",
  "sha1",
  "sha256",
  "sha512",
  "fingerprint",
  "checksum",
  "revision",
  "oid",
  "ref",
]);

/** Whether a property name ends in a word a model would copy back: `planHash`, `head_ref`, `oids`. */
export function providerHashLikeName(name: string): boolean {
  const words = name
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .split(/[^A-Za-z0-9]+/u)
    .filter((word) => word !== "")
    .map((word) => word.toLowerCase());
  const last = words.at(-1);
  if (last === undefined) return false;
  return COPIED_WORDS.has(last) || COPIED_WORDS.has(last.replace(/(?:es|s)$/u, ""));
}

/** A value that is a hash: a hex digest, with or without an algorithm prefix. */
export const PROVIDER_HASH_LIKE_VALUE = /^(?:sha(?:1|256|384|512):)?[0-9a-f]{40,128}$/iu;

/** A full hash inside prose, such as a description or an instruction. */
const EMBEDDED_HASH = /(?:sha(?:1|256|384|512):)?\b[0-9a-f]{40,128}\b/iu;

/**
 * ADR-0608: the kind of value an `enum` the shared reference helper built offers. A `path` or an
 * `anchor` repeats something the source holds by design, such as `docs/rule_<hex>.md` or a hunk's
 * own text, and the parser checks it against the item its reference names; the source check skips
 * those values, once each has the shape of its kind, and still checks every other offered value.
 * The kind is a key inside the schema, so it survives any rebuild, clone or serialization; only
 * `providerWireSchema`, at the provider boundary and after the check, removes it.
 */
export type ProviderReferenceKind = "reference" | "path" | "anchor";
export const PROVIDER_REFERENCE_KIND_KEY = "x-lervo-ref-kind";

/**
 * A repository-relative path whose directories hold no 32-digit hex run, though a file name may,
 * and which is more than an identifier or a hash.
 */
function pathShaped(value: string): boolean {
  if (value.length === 0 || value.length > 1024 || value.startsWith("/")) return false;
  // A path is never only an identifier or a hash.
  if (PROVIDER_HASH_LIKE_VALUE.test(value) || value.replace(IDENTIFIER, "") === "") return false;
  if (/[\\\u0000-\u001f]/u.test(value) || /^[a-z][a-z0-9+.-]*:/iu.test(value)) return false;
  const segments = value.split("/");
  return (
    segments.every((segment) => segment !== "" && segment !== "." && segment !== "..") &&
    segments.slice(0, -1).every((segment) => !/[0-9a-f]{32,}/iu.test(segment)) &&
    // A file name may hold hex, as `rule_<hex>.md` does, but is never only hex.
    !/^[0-9a-f]{8,}(?:\.[a-z0-9]+)?$/iu.test(segments.at(-1)!)
  );
}

/**
 * Anchor text: an `old -> new` pair of document lines that still holds letters or digits once every
 * hex run and identifier is taken out on at least one side, so an anchor can quote a SHA but never
 * be only hashes.
 */
function anchorShaped(value: string): boolean {
  if (value.length === 0 || value.length > 4096 || !value.includes(" -> ")) return false;
  return value
    .split(" -> ")
    .some((side) => /[\p{L}\p{N}]/u.test(side.replace(IDENTIFIER, "").replace(HEX_RUN, "")));
}

/** Whether `value` has the shape its kind requires. */
export function providerReferenceShaped(value: string, kind: ProviderReferenceKind): boolean {
  if (kind === "path") return pathShaped(value);
  if (kind === "anchor") return anchorShaped(value);
  return true;
}

/** An `enum` of the values a reference set offers, marked with their kind. */
export function providerReferenceEnum(
  values: readonly string[],
  kind: ProviderReferenceKind,
): { enum: string[] } {
  for (const value of values)
    if (!providerReferenceShaped(value, kind))
      throw new ProviderOutputSchemaError(`provider reference ${kind} has the wrong shape`);
  return kind === "reference"
    ? { enum: [...values] }
    : ({ enum: [...values], [PROVIDER_REFERENCE_KIND_KEY]: kind } as { enum: string[] });
}

/** The kind an `enum` was marked with, or undefined for any other value. */
export function providerReferenceKind(node: object): ProviderReferenceKind | undefined {
  const kind = (node as Record<string, unknown>)[PROVIDER_REFERENCE_KIND_KEY];
  return kind === "path" || kind === "anchor" ? kind : undefined;
}

/**
 * ADR-0608: the schema as a provider receives it: a deep copy without the reference-kind marks.
 * Call it only at the provider boundary, after the schema was checked.
 */
export function providerWireSchema<T>(schema: T): T {
  if (Array.isArray(schema)) return schema.map((item: unknown) => providerWireSchema(item)) as T;
  if (schema === null || typeof schema !== "object") return schema;
  return Object.fromEntries(
    Object.entries(schema as Record<string, unknown>)
      .filter(([key]) => key !== PROVIDER_REFERENCE_KIND_KEY)
      .map(([key, item]) => [key, providerWireSchema(item)]),
  ) as T;
}

export class ProviderOutputSchemaError extends Error {
  override name = "ProviderOutputSchemaError";
}

/** Every property name and every offered `enum` or `const` string of a schema, with its path. */
function walk(
  value: unknown,
  path: string,
  visit: (kind: "name" | "value" | "text", text: string, path: string, owner: object) => void,
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}[${index}]`, visit));
    return;
  }
  if (value === null || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  const fail = (reason: string) => {
    throw new ProviderOutputSchemaError(`provider output schema ${path}: ${reason}`);
  };
  if ("properties" in node) {
    const properties = node.properties;
    if (properties === null || typeof properties !== "object" || Array.isArray(properties))
      fail("properties is not an object");
    for (const name of Object.keys(properties as object)) visit("name", name, path, node);
  }
  if ("required" in node) {
    const required = node.required;
    if (!Array.isArray(required) || !required.every((name) => typeof name === "string"))
      fail("required is not a list of names");
    for (const name of required as string[]) visit("name", name, path, node);
  }
  // Every value a schema offers or suggests: `enum`, `const`, `default`, `examples`, `pattern`.
  for (const item of [
    ...(Array.isArray(node.enum) ? node.enum : []),
    ...("const" in node ? [node.const] : []),
    ...("default" in node ? [node.default] : []),
    ...(Array.isArray(node.examples) ? node.examples : []),
    ...(typeof node.pattern === "string" ? [node.pattern] : []),
  ])
    if (typeof item === "string") visit("value", item, path, node);
  if (typeof node.description === "string") visit("text", node.description, path, node);
  for (const [key, child] of Object.entries(node)) walk(child, `${path}.${key}`, visit);
}

function checkShape(schema: unknown): void {
  walk(schema, "$", (kind, text, path) => {
    if (kind === "name" && providerHashLikeName(text))
      throw new ProviderOutputSchemaError(`provider output schema ${path}: asks for ${text}`);
    if (kind === "value" && PROVIDER_HASH_LIKE_VALUE.test(text))
      throw new ProviderOutputSchemaError(
        `provider output schema ${path}: offers a hash as a value`,
      );
    if (kind === "text" && EMBEDDED_HASH.test(text))
      throw new ProviderOutputSchemaError(`provider output schema ${path}: describes a hash value`);
  });
}

/** Checks a provider output schema and brands it; a violation is a programming error. */
export function providerOutputSchema<T extends object>(schema: T): T & ProviderOutputSchema {
  checkShape(schema);
  return schema as T & ProviderOutputSchema;
}

const HEX_RUN = /[0-9a-f]{8,}/giu;
/**
 * A `prefix_id` identifier such as `kco_7f3a9c2e41b8`: its id part holds a digit, so a snake_case
 * word such as `prepare_publication`, which a schema may offer as an operation, is no identifier.
 */
const IDENTIFIER = /\b[a-z][a-z0-9]{1,15}_(?=[a-z0-9]*\d)[a-z0-9]{8,}\b/giu;

/** Every hex run of at least 8 digits and every `prefix_id` identifier in the source's strings. */
function sourceTokens(source: unknown): { hex: string; identifiers: Set<string> } {
  const hex: string[] = [];
  const identifiers = new Set<string>();
  const visit = (value: unknown) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(HEX_RUN)) hex.push(match[0].toLowerCase());
      for (const match of value.matchAll(IDENTIFIER)) identifiers.add(match[0].toLowerCase());
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        visit(key);
        visit(child);
      }
    }
  };
  visit(source);
  return { hex: `|${hex.join("|")}|`, identifiers };
}

/**
 * Checks a schema against the exact source data of one provider call: no property name or offered
 * value may equal an identifier or hash the source holds, or share a run of 8 or more hex digits
 * with one. A deserialized schema is checked whole, so this also guards one that crossed a
 * process boundary without its brand.
 */
export function assertProviderOutputSchemaForSource(
  schema: unknown,
  source: unknown,
): asserts schema is ProviderOutputSchema {
  checkShape(schema);
  const tokens = sourceTokens(source);
  walk(schema, "$", (kind, text, path, owner) => {
    // A path or anchor names something the source holds by design, and the parser binds it; it
    // must still have its kind's shape, so the mark cannot wave through an identifier or hash.
    const referenceKind = kind === "value" ? providerReferenceKind(owner) : undefined;
    if (referenceKind !== undefined) {
      if (providerReferenceShaped(text, referenceKind)) return;
      throw new ProviderOutputSchemaError(
        `provider output schema ${path}: offers a ${referenceKind} that is not shaped as one`,
      );
    }
    const lower = text.toLowerCase();
    const copied =
      tokens.identifiers.has(lower) ||
      tokens.hex.includes(`|${lower}|`) ||
      [...lower.matchAll(HEX_RUN)].some((run) => tokens.hex.includes(run[0]));
    if (copied)
      throw new ProviderOutputSchemaError(
        `provider output schema ${path}: ${kind === "name" ? "names" : "offers"} an identifier or hash from the source data`,
      );
  });
}

/** Words that ask a model to reproduce something as it was given. */
const COPY_WORDS =
  /\b(?:copy|copies|copied|echo|echoes|repeat|reproduce|verbatim|exactly as (?:given|shown|supplied)|return (?:it |them |the [a-z ]{0,30})?(?:exactly|unchanged|exact))\b/iu;
/** A word that names a copied value. */
const HASH_WORDS = /\b\w*(?:hash|hashes|digest|digests|sha|sha256|checksum|fingerprint)\b/iu;
const HASH_VALUE = /(?:sha(?:1|256|384|512):[0-9a-f]{8,}|\b[0-9a-f]{16,}\b)/giu;
const WINDOW = 120;

/**
 * ADR-0608: a Lervo-authored prompt or instruction may not ask a model to copy a hash back: a
 * sentence that asks to copy, echo or return something exactly and names a hash, or a hash value
 * with such a request within 120 characters, fails. It checks Lervo's own words, never the
 * untrusted data a call carries.
 */
export function assertProviderPromptAsksNoHashCopy(...texts: readonly string[]): void {
  for (const text of texts) {
    for (const sentence of text.split(/(?<=[.!?])\s+|\n+/u))
      if (COPY_WORDS.test(sentence) && HASH_WORDS.test(sentence))
        throw new ProviderOutputSchemaError(
          `provider prompt asks to copy a hash: ${sentence.trim().slice(0, 120)}`,
        );
    for (const match of text.matchAll(HASH_VALUE)) {
      const near = text.slice(
        Math.max(0, match.index - WINDOW),
        match.index + match[0].length + WINDOW,
      );
      if (COPY_WORDS.test(near))
        throw new ProviderOutputSchemaError(
          `provider prompt asks to copy the hash value ${match[0].slice(0, 12)}…`,
        );
    }
  }
}

/**
 * ADR-0608: the Lervo-written parts of a turn input. `untrusted` lists the parts Lervo did not write:
 * the owner's task, role and skill text, and repository or conversation data. Each one must occur
 * in the input, and everything else is Lervo's. With nothing declared the whole input is Lervo's,
 * so a builder that forgets to declare its data is refused rather than skipped.
 */
export function providerTurnAuthoredText(
  instructions: string,
  untrusted: readonly string[] = [],
): string[] {
  let parts = [instructions];
  for (const part of [...new Set(untrusted)].sort((left, right) => right.length - left.length)) {
    if (part.length === 0) continue;
    if (!instructions.includes(part))
      throw new ProviderOutputSchemaError(
        "provider turn input declares untrusted text that it does not contain",
      );
    parts = parts.flatMap((text) => text.split(part));
  }
  return parts.filter((text) => text.trim().length > 0);
}

/** ADR-0608: a turn input whose Lervo-written parts ask to copy a hash fails before it is sent. */
export function assertProviderTurnAsksNoHashCopy(
  instructions: string,
  untrusted: readonly string[] = [],
): void {
  assertProviderPromptAsksNoHashCopy(...providerTurnAuthoredText(instructions, untrusted));
}

/**
 * ADR-0608: the untrusted parts of a turn input that is one JSON object: every top-level value but
 * the named Lervo-written ones, as it appears in the input. Input that is not one JSON object
 * declares nothing, so all of it is checked.
 */
export function providerJsonTurnUntrusted(
  instructions: string,
  authoredKeys: readonly string[],
): string[] {
  let value: unknown;
  try {
    value = JSON.parse(instructions);
  } catch {
    return [];
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([key]) => !authoredKeys.includes(key))
    .map(([key, item]) => `${JSON.stringify(key)}:${JSON.stringify(item)}`);
}
