import type { DocumentLifecycleEvidence } from "./document-lifecycle-model.js";
import { pathNode, relationNodeParts, type RelationDocument } from "./relation-web-model.js";
import type { RelationSuspectEvidence } from "./relation-web-suspects.js";
import { relationNodeDocument, type RelationWeb } from "./relation-web.js";

const fencePattern = /^\s{0,3}(`{3,}|~{3,})\s*([A-Za-z0-9_+-]*)/u;
const inlineCodePattern = /(`+)([^`]+?)\1(?!`)/gu;
const wordPattern = /[A-Za-z_$][A-Za-z0-9_$]*/gu;
/** camelCase, PascalCase with an inner capital, snake_case, or SCREAMING_CASE outside code. */
const identifierShape =
  /^(?:[a-z$][a-z0-9$]*[A-Z][A-Za-z0-9$]*|[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*|[A-Za-z0-9$]+_[A-Za-z0-9_$]+)$/u;
/** A path, file name, flag, or shell command in a code span names a location, not a code name. */
const locationSpan =
  /^(?:[^\s]*[/\\][^\s]*|[^\s]+\.[A-Za-z0-9]{1,10}|--?[A-Za-z][^\s]*|(?:lervo|pnpm|npm|node|git|gh)\s.*)$/u;
/** Fences whose words are commands or prose rather than code names. */
const proseFences = new Set([
  "",
  "text",
  "txt",
  "bash",
  "sh",
  "shell",
  "zsh",
  "console",
  "markdown",
  "md",
]);
const MINIMUM_NAME_LENGTH = 4;
/** Words too common in code and documents to show that a change touched what a document names. */
const commonWords = new Set(
  (
    "this that with from have will when then than they them their there what which where while " +
    "into only also each must true false null undefined void none some more most other such " +
    "import export default const async await return function type interface class extends " +
    "string number boolean object array value values name names path paths file files line " +
    "lines code test tests docs apps packages src dist json yaml node lervo main index"
  ).split(" "),
);

/** Hashes and revisions name content, not code. */
const hexadecimal = /^(?=.*\d)[0-9a-f]{7,}$/iu;

function words(text: string): string[] {
  return [...text.matchAll(wordPattern)]
    .map((match) => match[0])
    .filter(
      (word) =>
        word.length >= MINIMUM_NAME_LENGTH &&
        !commonWords.has(word.toLowerCase()) &&
        !hexadecimal.test(word),
    );
}

/**
 * The code names a document mentions: the words of its code spans and code fences, except spans
 * that are paths, file names, flags, or commands and fences of shell or prose, plus the
 * identifier-shaped words of its prose such as `camelCase` or `snake_case`. Common words are
 * left out. A change whose added or removed lines contain none of them touched nothing the
 * document names.
 */
export function documentNamedIdentifiers(content: string): Set<string> {
  const names = new Set<string>();
  let fence: { marker: string; code: boolean } | null = null;
  for (const line of content.split(/\r?\n/u)) {
    const opening = fencePattern.exec(line);
    if (opening !== null) {
      if (fence === null)
        fence = { marker: opening[1]![0]!, code: !proseFences.has(opening[2]!.toLowerCase()) };
      else if (opening[1]![0] === fence.marker && opening[2] === "") fence = null;
      continue;
    }
    if (fence !== null) {
      if (fence.code) for (const word of words(line)) names.add(word);
      continue;
    }
    for (const match of line.matchAll(inlineCodePattern))
      if (!locationSpan.test(match[2]!.trim()))
        for (const word of words(match[2]!)) names.add(word);
    for (const word of words(line.replace(inlineCodePattern, " ")))
      if (identifierShape.test(word)) names.add(word);
  }
  return names;
}

/** The document's names that appear in a change's added or removed lines, sorted. */
export function namesTouchedByChange(
  names: ReadonlySet<string>,
  changedLines: readonly string[],
): string[] {
  const touched = new Set<string>();
  for (const line of changedLines)
    for (const word of words(line)) if (names.has(word)) touched.add(word);
  return [...touched].sort();
}

/** Whether a document names another document by link, path, header, or ADR number. */
function documentNames(web: RelationWeb, document: RelationDocument, target: string): boolean {
  return document.edges.some((edge) => {
    const node =
      edge.to === pathNode(document.path) && edge.evidence.sourceDocument === document.path
        ? edge.from
        : edge.to;
    return relationNodeDocument(web, node) === target;
  });
}

export interface LifecycleResolutionInput {
  web: RelationWeb;
  document: RelationDocument;
  evidence: RelationSuspectEvidence;
  /** The document's current bytes, or null when unreadable. */
  content: string | null;
  /**
   * Added and removed lines of a changed path, or null when they are unavailable (a binary or
   * unreadable diff), which leaves a `path_changed` reason to the provider.
   */
  changedLines: (changedPath: string) => readonly string[] | null;
}

const removalMarker =
  /\b(?:remov(?:e|ed|es|al|ing)|delet(?:e|ed|es|ion)|retir(?:e|ed|es|ing)|dropp(?:ed|ing)|no longer|replaced by)\b/iu;

/** The text a removal reason names: a path, a package name, or command words. */
function removedName(evidence: RelationSuspectEvidence): string {
  return relationNodeParts(evidence.target).key;
}

/**
 * Whether the document already records a removal: every line that names the removed path,
 * package, or command also says it was removed, deleted, retired, dropped, or replaced, such as
 * the ` (removed)` suffix the freshness path writes for a past fact (ADR-0463).
 */
export function documentRecordsRemoval(content: string, name: string): boolean {
  const lines = content.split(/\r?\n/u).filter((line) => line.includes(name));
  return lines.length > 0 && lines.every((line) => removalMarker.test(line));
}

/**
 * ADR-0562 deterministic resolution of one reverse-lookup reason, before any provider spend:
 *
 * - `target_amended`: an amendment adds to its target; it never invalidates a document naming it.
 * - `moved_target`: a reviewed lineage record maps the removed path; reference lint and link
 *   repair own the rewrite, so the lifecycle does not spend a provider call on it.
 * - `target_superseded`: settled when the document already names the superseding document.
 * - `path_changed`: settled when the changed lines contain no identifier the document names.
 * - `path_removed`, `package_removed`, `command_removed`: settled when every line naming the
 *   removed part already records its removal; otherwise the provider decides.
 * - `amended` and `superseded_in_part` are returned as null: missing reverse header lines are
 *   computed from the current web, not from one change (see `missingReverseHeaders`).
 */
export function resolveLifecycleReason(
  input: LifecycleResolutionInput,
): DocumentLifecycleEvidence | null {
  const { evidence } = input;
  switch (evidence.reason) {
    case "amended":
    case "superseded_in_part":
      return null;
    case "target_amended":
    case "moved_target":
      return { ...evidence, resolution: "deterministic" };
    case "target_superseded":
      return {
        ...evidence,
        resolution:
          evidence.via !== undefined && documentNames(input.web, input.document, evidence.via)
            ? "deterministic"
            : "provider",
      };
    case "path_changed": {
      const changed = evidence.via ?? relationNodeParts(evidence.target).key;
      const lines = input.changedLines(changed);
      if (lines === null || input.content === null) return { ...evidence, resolution: "provider" };
      const touched = namesTouchedByChange(documentNamedIdentifiers(input.content), lines);
      return touched.length === 0
        ? { ...evidence, resolution: "deterministic" }
        : { ...evidence, resolution: "provider", matchedNames: touched.slice(0, 16) };
    }
    default:
      return {
        ...evidence,
        resolution:
          input.content !== null && documentRecordsRemoval(input.content, removedName(evidence))
            ? "deterministic"
            : "provider",
      };
  }
}

/**
 * Reverse header lines another current declaration requires of this document: an amendment it
 * does not name back (`Amended by` or any link), a superseded part it does not name back, or a
 * full supersession its own `Status:` line does not declare. Each is a mechanical edit.
 */
export function missingReverseHeaders(
  web: RelationWeb,
  document: RelationDocument,
): DocumentLifecycleEvidence[] {
  if (document.historical) return [];
  const missing = new Map<string, DocumentLifecycleEvidence>();
  for (const edge of web.inbound.get(pathNode(document.path)) ?? []) {
    if (edge.kind !== "amends" && edge.kind !== "supersedes" && edge.kind !== "supersedes_part")
      continue;
    const declaring = edge.evidence.sourceDocument;
    if (declaring === document.path) continue;
    if (relationNodeDocument(web, edge.to) !== document.path) continue;
    const by = relationNodeDocument(web, edge.from);
    if (by === null || by === document.path) continue;
    const reason =
      edge.kind === "amends"
        ? "amended"
        : edge.kind === "supersedes_part"
          ? "superseded_in_part"
          : "superseded_undeclared";
    if (reason !== "superseded_undeclared" && documentNames(web, document, by)) continue;
    const key = `${reason}\u0000${by}`;
    if (!missing.has(key))
      missing.set(key, {
        reason,
        target: pathNode(by),
        edgeKind: edge.kind,
        line: 0,
        strength: "header",
        via: declaring,
        ...(edge.part === undefined ? {} : { part: edge.part }),
        resolution: "mechanical",
      });
  }
  return [...missing.values()];
}
