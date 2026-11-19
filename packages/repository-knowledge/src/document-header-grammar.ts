import { extractDocumentReferences } from "./document-references.js";

/**
 * ADR-0562 header grammar. The header is every line after optional YAML front matter and before
 * the first `##` heading, bounded to `MAXIMUM_HEADER_LINES`. A header line starts, optionally after
 * a list marker or indentation, with one key:
 *
 * - `Status:` whose first token is the lifecycle status. A value of `superseded by <targets>`
 *   declares an incoming `supersedes` relation.
 * - `Supersedes` (outgoing `supersedes`; targets after `in the named part:` are `supersedes_part`),
 *   `Supersedes in part` (outgoing `supersedes_part`), `Superseded by` and `Superseded in part by`
 *   (incoming), `Amends` (outgoing `amends`), `Amended by` (incoming), `Part of` (`part_of`), and
 *   `Related` (`related`).
 *
 * Targets are Markdown links, resolved like every other link, or bare `ADR-NNNN` numbers. Text
 * before the first target is a label; the targets end at the first sentence (`. `) or description
 * (`: `) boundary after it. A parenthetical directly after a target is its part label. A key line
 * without targets continues through the bulleted list below it, as in ADR-0560.
 */
export type DocumentHeaderRelation =
  "supersedes" | "supersedes_part" | "amends" | "part_of" | "related";

export type DocumentHeaderTargetReference =
  { kind: "path"; path: string } | { kind: "adr"; number: string };

export interface DocumentHeaderTarget {
  relation: DocumentHeaderRelation;
  /** `outgoing`: this document declares the relation; `incoming`: the target declares it here. */
  direction: "outgoing" | "incoming";
  target: DocumentHeaderTargetReference;
  /** One-based source line. */
  line: number;
  /** The named part, for a `supersedes_part` target with a parenthetical label. */
  part?: string;
}

export interface DocumentHeader {
  /** The lowercase first token of the `Status:` value, or null without one. */
  status: string | null;
  statusLine: number | null;
  targets: DocumentHeaderTarget[];
}

const MAXIMUM_HEADER_LINES = 80;
const MAXIMUM_PART_LABEL = 120;

const keyPattern =
  /^\s{0,8}(?:[-*]\s+)?(?:\*\*)?(Status|Supersedes in part|Supersedes|Superseded in part by|Superseded by|Amends|Amended by|Part of|Related)(?:\*\*)?(?=\s*:|\s+\[|\s+ADR-|,|\s*$)(.*)$/u;
const headingPattern = /^\s{0,3}#{2,6}\s/u;
const bulletPattern = /^\s{0,8}[-*]\s+/u;
const linkPattern =
  /\[(?:[^\]\\]|\\.)*\]\(\s*(?:<[^>]*>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/gu;
const adrPattern = /\bADR-(\d{3,5})\b/gu;
const parentheticalPattern = /\([^()]*\)/gu;
const namedPartPattern = /;?\s*in the named part:\s*/iu;
const statusTokenPattern = /^[`"'*_\s]*([A-Za-z][A-Za-z_-]*)[`"'*_]*(.*)$/u;
const historicalStatusPattern = /^(?:superseded|historical|archived)(?![a-z])/u;

interface KeyRule {
  relation: DocumentHeaderRelation;
  direction: DocumentHeaderTarget["direction"];
  /** `Supersedes` splits full and named-part targets. */
  namedParts: boolean;
}

const keyRules: Record<string, KeyRule> = {
  Supersedes: { relation: "supersedes", direction: "outgoing", namedParts: true },
  "Supersedes in part": { relation: "supersedes_part", direction: "outgoing", namedParts: false },
  "Superseded by": { relation: "supersedes", direction: "incoming", namedParts: false },
  "Superseded in part by": {
    relation: "supersedes_part",
    direction: "incoming",
    namedParts: false,
  },
  Amends: { relation: "amends", direction: "outgoing", namedParts: false },
  "Amended by": { relation: "amends", direction: "incoming", namedParts: false },
  "Part of": { relation: "part_of", direction: "outgoing", namedParts: false },
  Related: { relation: "related", direction: "outgoing", namedParts: false },
};

/** Header lines with their one-based numbers; front matter and the body after `##` are excluded. */
function documentHeaderLines(content: string): { text: string; line: number }[] {
  const lines = content.replace(/^\uFEFF/u, "").split(/\r?\n/u);
  let start = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/u.test(line));
    if (end > 0 && end <= 64) start = end + 1;
  }
  const header: { text: string; line: number }[] = [];
  for (let index = start; index < lines.length && header.length < MAXIMUM_HEADER_LINES; index++) {
    const text = lines[index]!;
    if (headingPattern.test(text)) break;
    header.push({ text, line: index + 1 });
  }
  return header;
}

function masked(value: string, pattern: RegExp): string {
  return value.replace(pattern, (match) => "_".repeat(match.length));
}

interface FoundTarget {
  start: number;
  end: number;
  target: DocumentHeaderTargetReference;
}

function segmentTargets(path: string, segment: string): FoundTarget[] {
  const found: FoundTarget[] = [];
  for (const match of segment.matchAll(linkPattern)) {
    const resolved = extractDocumentReferences({
      path,
      content: match[0],
      markdownLinksOnly: true,
    })[0];
    if (resolved !== undefined)
      found.push({
        start: match.index,
        end: match.index + match[0].length,
        target: { kind: "path", path: resolved.target },
      });
  }
  for (const match of masked(segment, linkPattern).matchAll(adrPattern))
    found.push({
      start: match.index,
      end: match.index + match[0].length,
      target: { kind: "adr", number: match[1]!.padStart(4, "0") },
    });
  found.sort((left, right) => left.start - right.start);
  const first = found[0];
  if (first === undefined) return [];
  // Labels precede the first target; a sentence or description boundary after it ends the list.
  const boundaryText = masked(masked(segment, linkPattern), parentheticalPattern);
  const boundary = /[.:](?:\s|$)/u.exec(boundaryText.slice(first.end));
  const limit = boundary === null ? segment.length : first.end + boundary.index;
  return found.filter((item) => item.start < limit);
}

function partLabel(segment: string, end: number): string | undefined {
  const label = /^\s*\(([^()]{1,200})\)/u.exec(segment.slice(end))?.[1]?.trim();
  return label === undefined || label === "" ? undefined : label.slice(0, MAXIMUM_PART_LABEL);
}

function lineTargets(
  path: string,
  value: string,
  line: number,
  rule: KeyRule,
): DocumentHeaderTarget[] {
  const [full, ...parts] = rule.namedParts ? value.split(namedPartPattern) : [value];
  const targets: DocumentHeaderTarget[] = [];
  const add = (segment: string, relation: DocumentHeaderRelation) => {
    for (const item of segmentTargets(path, segment)) {
      const part = relation === "supersedes_part" ? partLabel(segment, item.end) : undefined;
      targets.push({
        relation,
        direction: rule.direction,
        target: item.target,
        line,
        ...(part === undefined ? {} : { part }),
      });
    }
  };
  add(full ?? "", rule.relation);
  for (const segment of parts) add(segment, "supersedes_part");
  return targets;
}

function statusValue(rest: string): { status: string; remainder: string } | null {
  const match = statusTokenPattern.exec(rest.replace(/^\s*:?/u, ""));
  if (match === null) return null;
  const status = match[1]!.toLowerCase();
  // `superseded in part by …` is partial, and a partially superseded document stays current.
  return status === "superseded" && /^\s*in\s+part\b/iu.test(match[2]!)
    ? { status: "partially_superseded", remainder: match[2]! }
    : { status, remainder: match[2]! };
}

/** The lowercase first token of the header `Status:` line, or null. */
export function documentHeaderStatus(content: string): string | null {
  for (const { text } of documentHeaderLines(content)) {
    const match = keyPattern.exec(text);
    if (match?.[1] === "Status") return statusValue(match[2]!)?.status ?? null;
  }
  return null;
}

/** A status of `superseded`, `historical`, or `archived`, including suffixed forms. */
export function historicalHeaderStatus(status: string | null): boolean {
  return status !== null && historicalStatusPattern.test(status);
}

export function parseDocumentHeader(input: { path: string; content: string }): DocumentHeader {
  let status: string | null = null;
  let statusLine: number | null = null;
  const targets: DocumentHeaderTarget[] = [];
  let continuing: KeyRule | null = null;
  for (const { text, line } of documentHeaderLines(input.content)) {
    const match = keyPattern.exec(text);
    if (match !== null) {
      continuing = null;
      const key = match[1]!;
      if (key === "Status") {
        if (status !== null) continue;
        const value = statusValue(match[2]!);
        status = value?.status ?? null;
        statusLine = line;
        if (status === "superseded" && /^\s*by\b/u.test(value?.remainder ?? ""))
          targets.push(
            ...lineTargets(input.path, value!.remainder, line, keyRules["Superseded by"]!),
          );
        continue;
      }
      const rule = keyRules[key]!;
      const found = lineTargets(input.path, match[2]!, line, rule);
      targets.push(...found);
      if (found.length === 0 && /:\s*$/u.test(match[2]!)) continuing = rule;
      continue;
    }
    if (continuing === null) continue;
    if (text.trim() === "") continue;
    if (!bulletPattern.test(text)) {
      continuing = null;
      continue;
    }
    targets.push(...lineTargets(input.path, text.replace(bulletPattern, ""), line, continuing));
  }
  return { status, statusLine, targets };
}
