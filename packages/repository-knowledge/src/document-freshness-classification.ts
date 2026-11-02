import { parseManagedMarkdownBlocks } from "@lervo/documents";

import type {
  DocumentFreshnessChangeClass,
  DocumentFreshnessOperation,
  DocumentFreshnessOwnership,
  DocumentFreshnessPolicy,
} from "./document-freshness-contract.js";
import { lervoManagedRegions } from "./document-freshness-managed-regions.js";
import { documentFreshnessSafetyLine } from "./document-freshness-priority.js";

/**
 * Leading verbs that make an `AGENTS.md` or `CLAUDE.md` line an instruction. The list is closed so
 * classification stays deterministic; an unlisted verb falls back to `statement`, which still
 * needs two agreeing cross-checks on user-owned documents.
 */
const imperativeVerbs = new Set([
  "add",
  "always",
  "apply",
  "ask",
  "avoid",
  "call",
  "check",
  "commit",
  "create",
  "define",
  "do",
  "document",
  "ensure",
  "follow",
  "generate",
  "identify",
  "inspect",
  "keep",
  "make",
  "mark",
  "move",
  "never",
  "prefer",
  "push",
  "put",
  "read",
  "record",
  "register",
  "remove",
  "resolve",
  "run",
  "set",
  "start",
  "stop",
  "translate",
  "treat",
  "update",
  "use",
  "verify",
  "write",
]);

const instructionDocuments = /(?:^|\/)(?:AGENTS|CLAUDE)\.md$/u;
const decisionRecord = /^docs\/(?:decisions|adr)\/(?:.+\/)?\d{4}-[^/]+\.md$/u;
const tokenPattern = /[A-Za-z0-9_$][A-Za-z0-9_$./:@+-]*/gu;

export function documentFreshnessInstructionLine(line: string): boolean {
  const text = line
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/u, "")
    .replace(/^[*_`\s]+/u, "")
    .trimStart();
  const word = /^[A-Za-z]+/u.exec(text)?.[0]?.toLowerCase();
  return word !== undefined && imperativeVerbs.has(word);
}

function lineSpan(source: string, startByte: number, endByte: number): string[] {
  const bytes = Buffer.from(source, "utf8");
  const lineStart = bytes.lastIndexOf(0x0a, Math.max(0, startByte - 1)) + 1;
  let lineEnd = bytes.indexOf(0x0a, Math.max(startByte, endByte - 1));
  if (lineEnd < 0) lineEnd = bytes.byteLength;
  return bytes.subarray(lineStart, lineEnd).toString("utf8").split(/\r?\n/u);
}

function underDecisionHeading(source: string, startByte: number): boolean {
  const before = Buffer.from(source, "utf8").subarray(0, startByte).toString("utf8");
  const headings = [...before.matchAll(/^##\s+(.+?)\s*$/gmu)];
  return headings.at(-1)?.[1]?.trim().toLowerCase() === "decision";
}

function trimToken(token: string): string {
  return token.replace(/[.:,;]+$/u, "");
}

/** Tokens added by the replacement, as a multiset difference over the source span. */
export function documentFreshnessAddedTokens(before: string, replacement: string): string[] {
  const available = new Map<string, number>();
  for (const token of (before.match(tokenPattern) ?? []).map(trimToken))
    available.set(token, (available.get(token) ?? 0) + 1);
  const added: string[] = [];
  for (const token of (replacement.match(tokenPattern) ?? []).map(trimToken)) {
    const count = available.get(token) ?? 0;
    if (count > 0) available.set(token, count - 1);
    else if (token !== "") added.push(token);
  }
  return added;
}

/**
 * Deterministic change class: `safety_or_policy` wins when a spanned source line matches a safety
 * pattern, is an instruction line of `AGENTS.md` or `CLAUDE.md`, or lies under a decision record's
 * `## Decision` heading. `factual_reference` needs every added token to appear byte-exact in the
 * cited evidence. Everything else is `statement`.
 */
export function classifyDocumentFreshnessHunk(input: {
  documentPath: string;
  source: string;
  range: { startByte: number; endByte: number };
  replacement: string;
  citedEvidenceText: string;
  safetyPatterns: readonly string[];
}): DocumentFreshnessChangeClass {
  const lines = lineSpan(input.source, input.range.startByte, input.range.endByte);
  if (
    lines.some((line) => documentFreshnessSafetyLine(line, input.safetyPatterns)) ||
    (instructionDocuments.test(input.documentPath) &&
      lines.some(documentFreshnessInstructionLine)) ||
    (decisionRecord.test(input.documentPath) &&
      underDecisionHeading(input.source, input.range.startByte))
  )
    return "safety_or_policy";
  const before = Buffer.from(input.source, "utf8")
    .subarray(input.range.startByte, input.range.endByte)
    .toString("utf8");
  const added = documentFreshnessAddedTokens(before, input.replacement);
  if (added.length > 0 && added.every((token) => input.citedEvidenceText.includes(token)))
    return "factual_reference";
  return "statement";
}

export interface DocumentFreshnessRangeOwnership {
  ownership: DocumentFreshnessOwnership;
  managedBlockId: string | null;
}

/**
 * Ownership of a byte range: inside one `lervo_v1` managed block's content it is Lervo-managed
 * and patched through ADR-0022; otherwise the document's ownership applies. A range that touches
 * a marker, crosses a block boundary, or lies in a block the ADR-0022 parser cannot patch (a later
 * schema, or any block of a document that does not parse) returns null: that block belongs to its
 * own generator, and the candidate fails its structure check.
 */
export function documentFreshnessRangeOwnership(input: {
  bytes: Uint8Array;
  documentOwnership: DocumentFreshnessOwnership;
  range: { startByte: number; endByte: number };
}): DocumentFreshnessRangeOwnership | null {
  const { startByte, endByte } = input.range;
  const parsed = parseManagedMarkdownBlocks(input.bytes);
  for (const block of parsed.status === "valid" ? parsed.blocks : []) {
    const overlaps = startByte < block.fullRange.end && endByte > block.fullRange.start;
    if (!overlaps) continue;
    const inside = startByte >= block.contentRange.start && endByte <= block.contentRange.end;
    if (!inside || block.markerFamily !== "lervo_v1") return null;
    return { ownership: "lervo_managed", managedBlockId: block.blockId };
  }
  if (
    lervoManagedRegions(input.bytes).some(
      (region) => startByte < region.fullRange.end && endByte > region.fullRange.start,
    )
  )
    return null;
  return { ownership: input.documentOwnership, managedBlockId: null };
}

/**
 * Whether the ADR-0460 Tier 0 cross-check must agree before Lervo applies the change:
 * consequential classes, user-owned bytes, and archives. `never` is refused for user-owned bytes.
 */
export function documentFreshnessCrossCheckRequired(input: {
  ownership: DocumentFreshnessOwnership;
  changeClass: DocumentFreshnessChangeClass | null;
  operation: DocumentFreshnessOperation;
  policy: Pick<DocumentFreshnessPolicy, "crossCheck">;
}): boolean {
  if (input.policy.crossCheck === "always") return true;
  const consequential =
    input.operation === "archive" ||
    input.ownership === "user_owned" ||
    input.changeClass === "statement" ||
    input.changeClass === "safety_or_policy";
  if (input.policy.crossCheck === "never") return input.ownership === "user_owned";
  return consequential;
}

/**
 * Ownership of a whole document: the publication root and layout roles Lervo owns are
 * Lervo-managed; every other document, including `repository_tool` roles and documents without a
 * role, is user-owned. Managed blocks inside a user-owned document are resolved per range.
 */
export function documentFreshnessDocumentOwnership(input: {
  documentPath: string;
  publicationRoot: string;
  roles: readonly { path: string; lifecycleOwner: string; rewritePolicy: string }[];
}): DocumentFreshnessOwnership {
  if (input.documentPath.startsWith(`${input.publicationRoot.replace(/\/$/u, "")}/`))
    return "lervo_managed";
  return input.roles.some(
    (role) =>
      role.path === input.documentPath &&
      (role.lifecycleOwner === "lervo" || role.rewritePolicy === "lervo_exact"),
  )
    ? "lervo_managed"
    : "user_owned";
}

/**
 * ADR-0561: how many independent agreeing cross-checks a required change needs. A safety or policy
 * hunk, a user-owned statement hunk, and an archive need two; every other required change needs one.
 */
export function documentFreshnessRequiredAgreements(input: {
  ownership: DocumentFreshnessOwnership;
  changeClass: DocumentFreshnessChangeClass | null;
  operation: DocumentFreshnessOperation;
}): 1 | 2 {
  return input.operation === "archive" ||
    input.changeClass === "safety_or_policy" ||
    (input.ownership === "user_owned" && input.changeClass === "statement")
    ? 2
    : 1;
}
