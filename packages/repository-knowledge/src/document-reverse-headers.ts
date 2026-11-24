import { posix } from "node:path";

import { parseDocumentHeader, type DocumentHeaderTarget } from "./document-header-grammar.js";
import { missingReverseHeaders } from "./document-lifecycle-resolution.js";
import { relationNodeParts, type RelationDocument } from "./relation-web-model.js";
import type { RelationWeb } from "./relation-web.js";

/**
 * ADR-0631: the reverse header lines Lervo writes itself. Another decision record declares that it
 * amends this one, or supersedes a named part of it, and this record does not name it back. The
 * edit only inserts a new header line; it never changes an existing byte. A full supersession that
 * this record's `Status:` line does not declare would overwrite the owner's status, so it is never
 * planned here.
 */
export interface ReverseHeaderDeclaration {
  kind: "amended" | "superseded_in_part";
  /** The declaring decision record's repository path. */
  by: string;
  /** Its ADR number, zero-padded as the web records it. */
  adr: string;
  /** The named part, for `superseded_in_part`. */
  part?: string;
}

export type ReverseHeaderPlan =
  | {
      status: "planned";
      /** A zero-length range at the insertion point; the bytes around it are unchanged. */
      startByte: number;
      replacement: string;
      output: string;
    }
  | { status: "skipped"; reason: "no_status_line" | "document_bound" | "self_check_failed" };

/**
 * The document size bound the documentation lifecycle check holds every Markdown document to; the
 * root entrypoints have their own, smaller bounds (`documentFreshnessEntrypointBounds`). A reverse
 * line never pushes a record past it, so a long record keeps its reason instead of failing the
 * check that publication waits on.
 */
export const REVERSE_HEADER_DOCUMENT_BOUND = { bytes: 16_384, lines: 240 } as const;

/** Header lines kept in sync with `document-header-grammar.ts`. */
const MAXIMUM_HEADER_LINES = 80;
const MAXIMUM_PART_LABEL = 120;
const headingPattern = /^\s{0,3}#{2,6}\s/u;
const statusPattern = /^\s{0,8}(?:[-*]\s+)?(?:\*\*)?Status(?:\*\*)?\s*:/u;
/** Lines the reverse lines follow: status, date, and the supersession and amendment keys. */
const slotPattern =
  /^\s{0,8}(?:[-*]\s+)?(?:\*\*)?(?:Status|Decision date|Supersedes|Superseded|Amends|Amended by)\b/u;
const continuationPattern = /^(?:\s+\S|\s{0,8}[-*]\s+)/u;

/**
 * The reverse lines the web says this decision record lacks, in ADR order. Only a record that the
 * web knows as an ADR, and only lines another ADR declares, qualify.
 */
export function reverseHeaderDeclarations(
  web: RelationWeb,
  document: RelationDocument,
): ReverseHeaderDeclaration[] {
  if (document.historical || document.adr === null) return [];
  const declarations: ReverseHeaderDeclaration[] = [];
  for (const evidence of missingReverseHeaders(web, document)) {
    if (evidence.reason !== "amended" && evidence.reason !== "superseded_in_part") continue;
    const by = relationNodeParts(evidence.target).key;
    const adr = web.documents.get(by)?.adr ?? null;
    if (adr === null) continue;
    declarations.push({
      kind: evidence.reason,
      by,
      adr,
      ...(evidence.part === undefined ? {} : { part: evidence.part }),
    });
  }
  return declarations.sort(
    (left, right) =>
      left.adr.localeCompare(right.adr) ||
      left.kind.localeCompare(right.kind) ||
      (left.part ?? "").localeCompare(right.part ?? ""),
  );
}

function link(path: string, declaration: ReverseHeaderDeclaration): string {
  return `[ADR-${declaration.adr}](${posix.relative(posix.dirname(path), declaration.by)})`;
}

function partLabel(part: string | undefined): string {
  const label = (part ?? "")
    .replace(/[()\r\n]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return label === "" ? "" : ` (${label.slice(0, MAXIMUM_PART_LABEL)})`;
}

/** The new header lines: one `Amended by` line, then one line per superseded part. */
function reverseLines(path: string, declarations: readonly ReverseHeaderDeclaration[]): string[] {
  const amended = declarations.filter((declaration) => declaration.kind === "amended");
  const lines =
    amended.length === 0
      ? []
      : [`Amended by: ${amended.map((declaration) => link(path, declaration)).join(", ")}`];
  for (const declaration of declarations)
    if (declaration.kind === "superseded_in_part")
      lines.push(`Superseded in part by: ${link(path, declaration)}${partLabel(declaration.part)}`);
  return lines;
}

function targetKey(target: DocumentHeaderTarget): string {
  const reference =
    target.target.kind === "path" ? target.target.path : `adr:${target.target.number}`;
  return [target.relation, target.direction, reference, target.part ?? ""].join("\u0000");
}

/**
 * Plans the insertion of every missing reverse line after the record's status, date, supersession
 * and amendment lines, including any list continuing them. The plan is checked against the header
 * grammar: the output must keep every earlier target and status and add exactly the declared
 * incoming targets, so an insertion past the header bound or into an unexpected shape is refused.
 */
export function planReverseHeaderEdit(input: {
  path: string;
  content: string;
  declarations: readonly ReverseHeaderDeclaration[];
}): ReverseHeaderPlan {
  const { content } = input;
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content.split(/\r?\n/u);
  const lineStarts: number[] = [];
  let offset = 0;
  for (const match of content.matchAll(/[^\r\n]*(?:\r\n|\n|$)/gu)) {
    if (lineStarts.length === lines.length) break;
    lineStarts.push(offset);
    offset += match[0].length;
  }
  let start = 0;
  if (lines[0]?.replace(/^\uFEFF/u, "").trim() === "---") {
    const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/u.test(line));
    if (end > 0 && end <= 64) start = end + 1;
  }
  let end = start;
  while (
    end < lines.length &&
    end - start < MAXIMUM_HEADER_LINES &&
    !headingPattern.test(lines[end]!)
  )
    end++;
  const status = lines.slice(start, end).findIndex((line) => statusPattern.test(line));
  if (status < 0) return { status: "skipped", reason: "no_status_line" };
  // A slot line's list continues through blank lines, as the grammar reads it.
  let anchor = start + status;
  let listing = true;
  for (let index = anchor + 1; index < end; index++) {
    const line = lines[index]!;
    if (slotPattern.test(line)) {
      anchor = index;
      listing = true;
    } else if (line.trim() === "") continue;
    else if (listing && continuationPattern.test(line)) anchor = index;
    else listing = false;
  }
  const insertAt = lineStarts[anchor]! + lines[anchor]!.length;
  const replacement = reverseLines(input.path, input.declarations)
    .map((line) => `${eol}${line}`)
    .join("");
  const output = content.slice(0, insertAt) + replacement + content.slice(insertAt);
  if (
    Buffer.byteLength(output, "utf8") > REVERSE_HEADER_DOCUMENT_BOUND.bytes ||
    output.split(/\r?\n/u).length > REVERSE_HEADER_DOCUMENT_BOUND.lines
  )
    return { status: "skipped", reason: "document_bound" };
  const before = parseDocumentHeader({ path: input.path, content });
  const after = parseDocumentHeader({ path: input.path, content: output });
  const expected = new Set(before.targets.map(targetKey));
  for (const declaration of input.declarations)
    expected.add(
      [
        declaration.kind === "amended" ? "amends" : "supersedes_part",
        "incoming",
        declaration.by,
        declaration.kind === "superseded_in_part" ? partLabel(declaration.part).slice(2, -1) : "",
      ].join("\u0000"),
    );
  const actual = new Set(after.targets.map(targetKey));
  if (
    replacement === "" ||
    after.status !== before.status ||
    actual.size !== expected.size ||
    [...expected].some((key) => !actual.has(key))
  )
    return { status: "skipped", reason: "self_check_failed" };
  return {
    status: "planned",
    startByte: Buffer.byteLength(content.slice(0, insertAt), "utf8"),
    replacement,
    output,
  };
}
