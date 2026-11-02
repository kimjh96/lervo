import { defaultEnglishWritingContract, lintDeterministicWriting } from "@lervo/core";
import { parseManagedMarkdownBlocks } from "@lervo/documents";
import { fromMarkdown } from "mdast-util-from-markdown";

import type {
  DocumentFreshnessCheckCode,
  DocumentFreshnessCheckResult,
  DocumentFreshnessFindingV1,
  DocumentFreshnessHunk,
  DocumentFreshnessPolicy,
} from "./document-freshness-contract.js";
import { documentFreshnessRangeOwnership } from "./document-freshness-classification.js";
import { lervoManagedMarkerLines } from "./document-freshness-managed-regions.js";
import {
  documentFreshnessChangedBytes,
  documentFreshnessOutsideBytesUnchanged,
} from "./document-freshness-hunks.js";
import { extractDocumentReferences, MAXIMUM_DOCUMENT_REFERENCES } from "./document-references.js";
import {
  freshnessReferenceMissing,
  unresolvedDocumentReferences,
  type DocumentFreshnessTreeOracle,
} from "./document-freshness-references.js";
import { canonicalJson, sha256 } from "./integrity.js";
import { extractPublicReadmeCoordinates } from "./public-readme.js";

/** Root entrypoint size bounds; an edit may not grow an entrypoint past them. */
export const documentFreshnessEntrypointBounds: Record<string, { bytes: number; lines: number }> = {
  "README.md": { bytes: 12_288, lines: 160 },
  "AGENTS.md": { bytes: 8_192, lines: 120 },
  "CLAUDE.md": { bytes: 2_048, lines: 40 },
};

/** The writing contract an evidence bundle names; generation and checks use the same one. */
export function documentFreshnessWritingContract(): {
  writingPolicyId: string;
  contractHash: string;
} {
  return {
    writingPolicyId: defaultEnglishWritingContract.writingPolicyId,
    contractHash: sha256(canonicalJson(defaultEnglishWritingContract)),
  };
}

export interface DocumentFreshnessCheckInput {
  documentPath: string;
  source: Uint8Array;
  sourceHash: string;
  /** Hash of the bytes currently at the path, observed by the caller. */
  currentHash: string;
  output: Uint8Array;
  hunks: readonly DocumentFreshnessHunk[];
  finding: Pick<DocumentFreshnessFindingV1, "references">;
  /** `path\0hash` keys of every evidence item the bundle contains. */
  bundleEvidence: ReadonlySet<string>;
  policy: Pick<DocumentFreshnessPolicy, "maximumEditRatio" | "maximumEditBytes">;
  oracle: DocumentFreshnessTreeOracle;
}

function result(
  code: DocumentFreshnessCheckCode,
  passed: boolean,
  detail: string,
): DocumentFreshnessCheckResult {
  return { code, status: passed ? "passed" : "failed", detail };
}

interface HeadingShape {
  depth: number;
  text: string;
  line: number;
}

function headings(text: string): HeadingShape[] {
  const shapes: HeadingShape[] = [];
  const visit = (node: {
    type: string;
    depth?: number;
    value?: string;
    position?: { start: { line: number } };
    children?: unknown[];
  }): string => {
    if (typeof node.value === "string") return node.value;
    const inner = (node.children ?? [])
      .map((child) => visit(child as Parameters<typeof visit>[0]))
      .join("");
    if (node.type === "heading")
      shapes.push({
        depth: node.depth ?? 0,
        text: inner,
        line: node.position?.start.line ?? 0,
      });
    return inner;
  };
  visit(fromMarkdown(text) as unknown as Parameters<typeof visit>[0]);
  return shapes;
}

function lineOfByte(text: Uint8Array, byte: number): number {
  let line = 1;
  for (let index = 0; index < byte && index < text.byteLength; index += 1)
    if (text[index] === 0x0a) line += 1;
  return line;
}

function structureCheck(input: DocumentFreshnessCheckInput): DocumentFreshnessCheckResult {
  const source = Buffer.from(input.source).toString("utf8");
  const output = Buffer.from(input.output).toString("utf8");
  let before: HeadingShape[];
  let after: HeadingShape[];
  try {
    before = headings(source);
    after = headings(output);
  } catch {
    return result("commonmark_structure", false, "markdown_unparseable");
  }
  const headingHunkLines = new Set(
    input.hunks
      .filter((hunk) => hunk.changeClass === "factual_reference")
      .flatMap((hunk) => {
        const first = lineOfByte(input.source, hunk.range.startByte);
        const last = lineOfByte(input.source, hunk.range.endByte);
        return Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
      }),
  );
  if (before.length !== after.length)
    return result("commonmark_structure", false, "heading_count_changed");
  for (const [index, heading] of before.entries()) {
    const next = after[index]!;
    if (heading.depth !== next.depth)
      return result("commonmark_structure", false, `heading_depth_changed:${index}`);
    if (heading.text !== next.text && !headingHunkLines.has(heading.line))
      return result("commonmark_structure", false, `heading_text_changed:${index}`);
  }
  if (
    JSON.stringify(lervoManagedMarkerLines(input.source)) !==
    JSON.stringify(lervoManagedMarkerLines(input.output))
  )
    return result("commonmark_structure", false, "managed_markers_changed");
  if (
    input.hunks.some(
      (hunk) =>
        documentFreshnessRangeOwnership({
          bytes: input.source,
          documentOwnership: hunk.ownership,
          range: hunk.range,
        }) === null,
    )
  )
    return result("commonmark_structure", false, "managed_block_not_patchable");
  const managedBefore = parseManagedMarkdownBlocks(input.source);
  const managedAfter = parseManagedMarkdownBlocks(input.output);
  if (managedBefore.status === "valid" && managedAfter.status !== "valid")
    return result("commonmark_structure", false, "managed_markers_invalid");
  return result("commonmark_structure", true, `headings=${after.length}`);
}

/** The complete output lines each hunk's replacement occupies, in output coordinates. */
function replacedOutputLines(
  output: Uint8Array,
  hunks: readonly DocumentFreshnessHunk[],
): string[] {
  const bytes = Buffer.from(output);
  const ordered = [...hunks].sort((left, right) => left.range.startByte - right.range.startByte);
  const result: string[] = [];
  let delta = 0;
  for (const hunk of ordered) {
    const length = Buffer.byteLength(hunk.replacement);
    const start = hunk.range.startByte + delta;
    delta += length - (hunk.range.endByte - hunk.range.startByte);
    const lineStart = bytes.lastIndexOf(0x0a, start - 1) + 1;
    const next = bytes.indexOf(0x0a, start + length);
    result.push(bytes.subarray(lineStart, next === -1 ? bytes.length : next).toString("utf8"));
  }
  return result;
}

function referencesCheck(input: DocumentFreshnessCheckInput): DocumentFreshnessCheckResult[] {
  const output = Buffer.from(input.output).toString("utf8");
  const neverTracked = new Set(
    input.finding.references
      .filter((reference) => reference.neverTracked)
      .map((reference) => reference.target),
  );
  const unresolved = unresolvedDocumentReferences({
    path: input.documentPath,
    content: output,
    oracle: input.oracle,
    neverTracked,
  });
  // The extractor stops at its reference cap, so a reference an edit adds past the cap would go
  // unseen. Then the whole output lines of every replacement are checked on their own as well; a
  // replacement can be part of a link target, so the replacement text alone is not enough.
  // A replaced line that itself reaches the cap cannot be checked completely, so it fails closed.
  let unchecked = false;
  if (
    extractDocumentReferences({ path: input.documentPath, content: output }).length >=
    MAXIMUM_DOCUMENT_REFERENCES
  )
    for (const lines of replacedOutputLines(input.output, input.hunks)) {
      if (
        extractDocumentReferences({ path: input.documentPath, content: lines }).length >=
        MAXIMUM_DOCUMENT_REFERENCES
      )
        unchecked = true;
      unresolved.push(
        ...unresolvedDocumentReferences({
          path: input.documentPath,
          content: lines,
          oracle: input.oracle,
          neverTracked,
        }),
      );
    }
  // Unresolved references on a line that marks history were already excluded above.
  const remaining = input.finding.references.filter(
    (reference) =>
      freshnessReferenceMissing(reference) &&
      unresolved.some(
        (item) => item.target === reference.target && (item.symbol ?? null) === reference.symbol,
      ),
  );
  return [
    result(
      "references_resolve",
      unresolved.length === 0 && !unchecked,
      unchecked
        ? "reference_limit_reached"
        : unresolved.length === 0
          ? "all_references_resolve"
          : `unresolved=${unresolved
              .slice(0, 5)
              .map((reference) => reference.target)
              .join(",")}`,
    ),
    result(
      "missing_references_resolved",
      remaining.length === 0,
      remaining.length === 0
        ? "finding_references_resolved"
        : `still_missing=${remaining
            .slice(0, 5)
            .map((reference) => reference.target)
            .join(",")}`,
    ),
  ];
}

function claimsCheck(input: DocumentFreshnessCheckInput): DocumentFreshnessCheckResult {
  for (const hunk of input.hunks) {
    if (hunk.claims.length === 0) return result("claims_bound", false, `${hunk.hunkId}:no_claim`);
    for (const claim of hunk.claims) {
      if (claim.evidence.length === 0)
        return result("claims_bound", false, `${hunk.hunkId}:claim_without_evidence`);
      for (const evidence of claim.evidence)
        if (!input.bundleEvidence.has(`${evidence.path}\0${evidence.hash}`))
          return result("claims_bound", false, `${hunk.hunkId}:evidence_not_in_bundle`);
    }
  }
  return result("claims_bound", true, `hunks=${input.hunks.length}`);
}

function editBoundCheck(input: DocumentFreshnessCheckInput): DocumentFreshnessCheckResult {
  const changed = documentFreshnessChangedBytes(input.source, input.hunks);
  const ratioLimit = Math.floor(input.source.byteLength * input.policy.maximumEditRatio);
  const limit = Math.min(Math.max(ratioLimit, 1), input.policy.maximumEditBytes);
  return result("edit_bound", changed <= limit, `changed=${changed};limit=${limit}`);
}

function entrypointCheck(input: DocumentFreshnessCheckInput): DocumentFreshnessCheckResult {
  const bound = documentFreshnessEntrypointBounds[input.documentPath];
  if (bound === undefined) return result("entrypoint_bounds", true, "not_entrypoint");
  const outputText = Buffer.from(input.output).toString("utf8");
  const sourceText = Buffer.from(input.source).toString("utf8");
  const lines = (text: string) => text.split(/\r?\n/u).length;
  // An entrypoint already above its bound may shrink or stay, never grow.
  const bytesOk =
    input.output.byteLength <= bound.bytes || input.output.byteLength <= input.source.byteLength;
  const linesOk = lines(outputText) <= bound.lines || lines(outputText) <= lines(sourceText);
  if (!bytesOk || !linesOk)
    return result(
      "entrypoint_bounds",
      false,
      `bytes=${input.output.byteLength};lines=${lines(outputText)}`,
    );
  if (input.documentPath === "README.md") {
    // Repository paths look like package names to the README inventory; the reference checks
    // above own them, so only real package names, badges, commands, and tables stay protected.
    const stalePaths = new Set(
      input.finding.references.filter(freshnessReferenceMissing).map((item) => item.target),
    );
    const protectedValues = (text: string) =>
      extractPublicReadmeCoordinates(text)
        .filter(
          (coordinate) =>
            coordinate.kind !== "link_target" &&
            !(
              coordinate.kind === "package_name" &&
              (stalePaths.has(coordinate.value) || input.oracle.exists(coordinate.value))
            ),
        )
        .map((coordinate) => `${coordinate.kind}\0${coordinate.valueHash}`)
        .sort()
        .join("\n");
    if (protectedValues(sourceText) !== protectedValues(outputText))
      return result("entrypoint_bounds", false, "protected_readme_coordinates_changed");
  }
  return result("entrypoint_bounds", true, "within_bounds");
}

function writingCheck(input: DocumentFreshnessCheckInput): DocumentFreshnessCheckResult {
  const violations = (text: string) =>
    lintDeterministicWriting(text, defaultEnglishWritingContract).reduce(
      (total, check) =>
        total +
        // An isolated hunk has no section body around it, so section emptiness is not judged here.
        (check.checkId === "no_empty_sections" ? 0 : check.violationCount),
      0,
    );
  for (const hunk of input.hunks) {
    const before = Buffer.from(
      input.source.subarray(hunk.range.startByte, hunk.range.endByte),
    ).toString("utf8");
    if (violations(hunk.replacement) > violations(before))
      return result("writing_contract", false, `${hunk.hunkId}:new_writing_violation`);
  }
  return result("writing_contract", true, defaultEnglishWritingContract.writingPolicyId);
}

/**
 * Every ADR-0463 deterministic check for an `edit` candidate. Each check records its own result,
 * so a rejection names every failed rule, not only the first.
 */
export function runDocumentFreshnessChecks(
  input: DocumentFreshnessCheckInput,
): DocumentFreshnessCheckResult[] {
  return [
    result(
      "source_hash",
      input.currentHash === input.sourceHash && sha256(input.source) === input.sourceHash,
      input.currentHash === input.sourceHash ? "source_current" : "source_changed",
    ),
    result(
      "outside_bytes_unchanged",
      documentFreshnessOutsideBytesUnchanged(input.source, input.output, input.hunks),
      `hunks=${input.hunks.length}`,
    ),
    structureCheck(input),
    ...referencesCheck(input),
    claimsCheck(input),
    editBoundCheck(input),
    entrypointCheck(input),
    writingCheck(input),
  ];
}

/** The stable failure code a failed check maps to; the first failure in check order wins. */
export function documentFreshnessCheckFailure(
  checks: readonly DocumentFreshnessCheckResult[],
):
  | "source_changed"
  | "outside_bytes_changed"
  | "reference_unresolved"
  | "claim_unbound"
  | "candidate_invalid"
  | null {
  const failed = checks.find((check) => check.status === "failed");
  if (failed === undefined) return null;
  switch (failed.code) {
    case "source_hash":
      return "source_changed";
    case "outside_bytes_unchanged":
    case "commonmark_structure":
    case "edit_bound":
      return "outside_bytes_changed";
    case "references_resolve":
    case "missing_references_resolved":
      return "reference_unresolved";
    case "claims_bound":
      return "claim_unbound";
    default:
      return "candidate_invalid";
  }
}
