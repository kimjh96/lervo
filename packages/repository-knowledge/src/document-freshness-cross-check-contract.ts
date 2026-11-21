import type { DocumentFreshnessCrossCheckVerdict } from "./document-freshness-contract.js";
import type { DocumentFreshnessCrossCheckInputV1 } from "./document-freshness-cross-check.js";
import {
  referencingArraySchema,
  reviewReferences,
  type ReviewReferenceSet,
} from "./review-references.js";
import { providerOutputSchema } from "@lervo/schemas";
import type { ProviderOutputSchema } from "@lervo/schemas";

const MAXIMUM_HUNKS = 16;
const MAXIMUM_REASON_CHARACTERS = 400;
const MAXIMUM_ANCHOR_SIDE_CHARACTERS = 40;

type Hunk = DocumentFreshnessCrossCheckInputV1["hunks"][number];

function anchorSide(text: string): string {
  const line =
    text
      .split("\n")
      .find((item) => item.trim().length > 0)
      ?.trim() ?? "";
  const characters = [...line];
  if (characters.length === 0) return "(nothing)";
  return characters.length <= MAXIMUM_ANCHOR_SIDE_CHARACTERS
    ? line
    : `${characters.slice(0, MAXIMUM_ANCHOR_SIDE_CHARACTERS).join("")}...`;
}

/**
 * ADR-0604: each hunk's natural key, the start of its before and after text (`old -> new`). The
 * answer names it next to the hunk reference, so a verdict filed under another hunk's reference
 * is rejected. Equal keys get a counter, so every hunk keeps its own key.
 */
export function documentFreshnessHunkAnchors(hunks: readonly Hunk[]): string[] {
  const used = new Set<string>();
  return hunks.map((hunk) => {
    const base = `${anchorSide(hunk.before)} -> ${anchorSide(hunk.after)}`;
    let anchor = base;
    for (let count = 2; used.has(anchor); count += 1) anchor = `${base} (${count})`;
    used.add(anchor);
    return anchor;
  });
}

/**
 * ADR-0604: one Tier 0 call's contract, shared by the request and the parser. The reviewer sees
 * the stored input with a short reference in place of every hunk id (`h1`) and evidence hash
 * (`e1`), and each hunk with its anchor. The schema allows only those hunk references and anchors,
 * an answer names both, and `parse` maps them back to the exact hunk ids. The stored input keeps
 * the exact identifiers.
 */
export interface DocumentFreshnessCrossCheckContract {
  schema: ProviderOutputSchema;
  view: unknown;
  /** One bounded verdict per hunk, no unknown, mispaired or duplicate reference; null if invalid. */
  parse(value: unknown): DocumentFreshnessCrossCheckVerdict[] | null;
}

export function documentFreshnessCrossCheckContract(
  input: DocumentFreshnessCrossCheckInputV1,
): DocumentFreshnessCrossCheckContract {
  const anchors = documentFreshnessHunkAnchors(input.hunks);
  const anchorOf = new Map(input.hunks.map((hunk, index) => [hunk, anchors[index]!]));
  const hunks = reviewReferences(input.hunks, {
    prefix: "h",
    path: (hunk) => anchorOf.get(hunk)!,
    pathKind: "anchor",
  });
  const evidence = reviewReferences(input.evidence, { prefix: "e" });
  const cited = new Map(
    input.evidence.map((item, index) => [`${item.path}\0${item.hash}`, evidence.reference(index)]),
  );
  const verdict =
    hunks.schema === null
      ? null
      : providerOutputSchema({
          type: "object",
          additionalProperties: false,
          properties: {
            hunk: hunks.schema,
            anchor: hunks.pathSchema,
            verdict: { enum: ["agree", "disagree"] },
            reason: { type: "string", minLength: 1, maxLength: MAXIMUM_REASON_CHARACTERS },
          },
          required: ["hunk", "anchor", "verdict", "reason"],
        });
  return {
    schema: providerOutputSchema({
      type: "object",
      additionalProperties: false,
      properties: {
        hunks: referencingArraySchema(verdict, {
          minItems: input.hunks.length,
          maxItems: input.hunks.length,
        }),
      },
      required: ["hunks"],
    }),
    view: {
      ...input,
      hunks: input.hunks.map(({ hunkId: _hunkId, claims, ...hunk }, index) => ({
        hunk: hunks.reference(index),
        anchor: anchors[index]!,
        ...hunk,
        claims: claims.map((claim) => ({
          text: claim.text,
          evidence: claim.evidence.map((citation) => ({
            evidence: cited.get(`${citation.path}\0${citation.hash}`) ?? null,
            path: citation.path,
          })),
        })),
      })),
      evidence: input.evidence.map(({ hash: _hash, ...item }, index) => ({
        evidence: evidence.reference(index),
        ...item,
      })),
    },
    parse: (value) => parseVerdicts(value, hunks),
  };
}

function parseVerdicts(
  value: unknown,
  hunks: ReviewReferenceSet<Hunk>,
): DocumentFreshnessCrossCheckVerdict[] | null {
  const item = value as { hunks?: unknown } | null;
  if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
  if (Object.keys(item).some((key) => key !== "hunks")) return null;
  if (!Array.isArray(item.hunks) || item.hunks.length > MAXIMUM_HUNKS) return null;
  const verdicts = new Map<string, DocumentFreshnessCrossCheckVerdict>();
  for (const raw of item.hunks as unknown[]) {
    const entry = raw as {
      hunk?: unknown;
      anchor?: unknown;
      verdict?: unknown;
      reason?: unknown;
    } | null;
    // The hunk reference and its anchor must name the same hunk.
    const hunk =
      entry === null || typeof entry !== "object"
        ? undefined
        : hunks.resolve(entry.hunk, entry.anchor);
    if (
      entry === null ||
      hunk === undefined ||
      Object.keys(entry).some((key) => !["hunk", "anchor", "verdict", "reason"].includes(key)) ||
      verdicts.has(hunk.hunkId) ||
      (entry.verdict !== "agree" && entry.verdict !== "disagree") ||
      typeof entry.reason !== "string" ||
      entry.reason.trim().length === 0 ||
      entry.reason.length > MAXIMUM_REASON_CHARACTERS
    )
      return null;
    verdicts.set(hunk.hunkId, {
      hunkId: hunk.hunkId,
      verdict: entry.verdict,
      reason: entry.reason,
    });
  }
  if (verdicts.size !== hunks.items.length) return null;
  return hunks.items.map((hunk) => verdicts.get(hunk.hunkId)!);
}
