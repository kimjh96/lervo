import {
  referencingArraySchema,
  reviewReferences,
  type DocumentNormalizationCandidate,
  type DocumentNormalizationCandidateItem,
  type ReviewReferenceSet,
} from "@lervo/repository-knowledge";

import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { providerOutputSchema, providerReferenceEnum } from "@lervo/schemas";
import type { ProviderOutputSchema } from "@lervo/schemas";

const checks = [
  "meaning",
  "requirements",
  "examples",
  "links",
  "lifecycle",
  "protectedRegions",
  "skillIdentity",
  "resources",
] as const;

/**
 * ADR-0604: the version of the review contract below, part of every key derived from it. Version 1
 * asked the reviewer to copy operation ids, content hashes and unit version ids back verbatim;
 * version 2 cited outputs by reference alone and allowed every document's references everywhere.
 */
export const NORMALIZATION_REVIEW_CONTRACT_VERSION = "lervo.normalization-review.v3";

export interface NormalizationSemanticDecision {
  operationId: string;
  sourceContentHash: string;
  decision: "approve" | "reject";
  rationale: string;
  checks: Record<(typeof checks)[number], boolean>;
  unitReviews: { unitVersionId: string; outputHashes: string[]; rationale: string }[];
}

/**
 * ADR-0604: one candidate's review contract, which the request and the parser share. The reviewer
 * sees the candidate with a short reference in place of every identifier it must cite (`d1` for a
 * document, `d1.u2` for a source unit, `d1.o3` for an output), and the schema allows only those
 * references, so a mistyped 64-character hash can no longer be produced. Each document's answer
 * may cite only that document's units and outputs, and each output is cited with its path, so a
 * valid reference to the wrong output is rejected too. `parse` maps the references back to the
 * exact identifiers and keeps every rule a schema cannot state.
 */
export interface NormalizationReviewContract {
  version: typeof NORMALIZATION_REVIEW_CONTRACT_VERSION;
  schema: ProviderOutputSchema;
  /** The candidate as the reviewer sees it, with references in place of identifiers. */
  view: unknown;
  parse(value: unknown): NormalizationSemanticDecision[];
}

interface Document {
  reference: string;
  item: DocumentNormalizationCandidateItem;
  units: ReviewReferenceSet<string>;
  outputs: ReviewReferenceSet<DocumentNormalizationCandidateItem["outputs"][number]>;
  /** Each output's covered unit references. */
  covered: Map<string, ReadonlySet<string>>;
}

function documents(candidate: DocumentNormalizationCandidate): {
  set: ReviewReferenceSet<DocumentNormalizationCandidateItem>;
  entries: Document[];
} {
  const set = reviewReferences(candidate.items, { prefix: "d", path: (item) => item.sourcePath });
  const entries = candidate.items.map((item, index) => {
    const reference = set.reference(index);
    const units = reviewReferences(item.sourceUnitVersionIds, { prefix: `${reference}.u` });
    const outputs = reviewReferences(item.outputs, {
      prefix: `${reference}.o`,
      path: (output) => output.path,
    });
    const unitReference = new Map(units.items.map((id, unit) => [id, units.reference(unit)]));
    const covered = new Map(
      item.outputs.map((output, position) => [
        outputs.reference(position),
        new Set(
          output.coveredUnitVersionIds
            .map((id) => unitReference.get(id))
            .filter((alias): alias is string => alias !== undefined),
        ) as ReadonlySet<string>,
      ]),
    );
    return { reference, item, units, outputs, covered };
  });
  return { set, entries };
}

function view(candidate: DocumentNormalizationCandidate, entries: readonly Document[]) {
  return {
    outputLanguage: candidate.outputLanguage,
    formatVersion: candidate.formatVersion,
    documents: entries.map(({ reference, item, units, outputs, covered }) => ({
      document: reference,
      sourcePath: item.sourcePath,
      profile: item.profile,
      sourceByteCount: item.sourceByteCount,
      units: [...units.references],
      resources: item.resourceBindings.map((binding) => binding.path),
      outputs: item.outputs.map((output, position) => ({
        output: outputs.reference(position),
        path: output.path,
        content: output.content,
        coversUnits: [...covered.get(outputs.reference(position))!],
      })),
    })),
  };
}

/** One document's answer: it may cite only this document's own units and outputs. */
function documentSchema(entry: Document): ProviderOutputSchema {
  return providerOutputSchema({
    type: "object",
    additionalProperties: false,
    properties: {
      document: { enum: [entry.reference] },
      sourcePath: providerReferenceEnum([entry.item.sourcePath], "path"),
      decision: { enum: ["approve", "reject"] },
      rationale: { type: "string", minLength: 40, maxLength: 4_096 },
      checks: {
        type: "object",
        additionalProperties: false,
        // ADR-0604: literal names, so the provider schema guard reads each one.
        properties: {
          meaning: { type: "boolean" },
          requirements: { type: "boolean" },
          examples: { type: "boolean" },
          links: { type: "boolean" },
          lifecycle: { type: "boolean" },
          protectedRegions: { type: "boolean" },
          skillIdentity: { type: "boolean" },
          resources: { type: "boolean" },
        } satisfies Record<(typeof checks)[number], { type: "boolean" }>,
        required: [
          "meaning",
          "requirements",
          "examples",
          "links",
          "lifecycle",
          "protectedRegions",
          "skillIdentity",
          "resources",
        ] satisfies (typeof checks)[number][],
      },
      // ADR-0604: never an empty `enum`; a document without units or outputs cites none.
      unitReviews: referencingArraySchema(
        entry.units.schema === null || entry.outputs.schema === null
          ? null
          : {
              type: "object",
              additionalProperties: false,
              properties: {
                unit: entry.units.schema,
                outputs: {
                  type: "array",
                  items: {
                    type: "object",
                    additionalProperties: false,
                    properties: { output: entry.outputs.schema, path: entry.outputs.pathSchema },
                    required: ["output", "path"],
                  },
                },
                rationale: { type: "string", minLength: 20, maxLength: 2_048 },
              },
              required: ["unit", "outputs", "rationale"],
            },
      ),
    },
    required: ["document", "sourcePath", "decision", "rationale", "checks", "unitReviews"],
  });
}

function schema(entries: readonly Document[]): ProviderOutputSchema {
  return providerOutputSchema({
    type: "object",
    additionalProperties: false,
    properties: {
      decisions: {
        type: "array",
        minItems: entries.length,
        maxItems: entries.length,
        items: { anyOf: entries.map(documentSchema) },
      },
    },
    required: ["decisions"],
  });
}

const invalid = () => new KnowledgeConvergenceRuntimeError("knowledge_semantic_review_invalid");

function decisionFor(entry: Document, value: unknown): NormalizationSemanticDecision {
  const answer = value as {
    decision?: unknown;
    rationale?: unknown;
    checks?: Record<string, unknown> | null;
    unitReviews?: unknown;
  };
  if (
    (answer.decision !== "approve" && answer.decision !== "reject") ||
    typeof answer.rationale !== "string" ||
    answer.rationale.trim().length < 40 ||
    answer.rationale.length > 4_096 ||
    answer.checks === null ||
    typeof answer.checks !== "object" ||
    !checks.every((check) => typeof answer.checks![check] === "boolean") ||
    !Array.isArray(answer.unitReviews)
  )
    throw invalid();
  const reviews = answer.unitReviews as {
    unit?: unknown;
    outputs?: unknown;
    rationale?: unknown;
  }[];
  const decision: NormalizationSemanticDecision = {
    operationId: entry.item.operationId,
    sourceContentHash: entry.item.sourceContentHash,
    decision: answer.decision,
    rationale: answer.rationale,
    checks: Object.fromEntries(
      checks.map((check) => [check, answer.checks![check] === true]),
    ) as NormalizationSemanticDecision["checks"],
    unitReviews: [],
  };
  if (answer.decision === "reject") return decision;
  // An approval binds every source unit of this document exactly once, each to outputs of this
  // document that cover it, and passes every check.
  if (
    !checks.every((check) => decision.checks[check]) ||
    reviews.length !== entry.units.items.length ||
    new Set(reviews.map((review) => review?.unit)).size !== entry.units.items.length
  )
    throw invalid();
  decision.unitReviews = reviews.map((review) => {
    const unitVersionId = entry.units.resolve(review?.unit);
    const outputs = Array.isArray(review?.outputs) ? (review.outputs as unknown[]) : [];
    if (
      unitVersionId === undefined ||
      typeof review.rationale !== "string" ||
      review.rationale.trim().length < 20 ||
      review.rationale.length > 2_048 ||
      outputs.length === 0 ||
      new Set(outputs.map((cited) => (cited as { output?: unknown } | null)?.output)).size !==
        outputs.length
    )
      throw invalid();
    return {
      unitVersionId,
      outputHashes: outputs.map((raw) => {
        // An output reference of this document, paired with that output's path.
        const cited = raw as { output?: unknown; path?: unknown } | null;
        const output = entry.outputs.resolve(cited?.output, cited?.path);
        if (
          output === undefined ||
          !entry.covered.get(cited!.output as string)!.has(review.unit as string)
        )
          throw invalid();
        return output.contentHash;
      }),
      rationale: review.rationale,
    };
  });
  return decision;
}

export function normalizationReviewContract(
  candidate: DocumentNormalizationCandidate,
): NormalizationReviewContract {
  if (candidate.items.length === 0)
    throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_invalid");
  const { set, entries } = documents(candidate);
  return {
    version: NORMALIZATION_REVIEW_CONTRACT_VERSION,
    schema: schema(entries),
    view: view(candidate, entries),
    /** Semantic approvals bind every exact source unit and output; the generator cannot self-approve. */
    parse: (value) => {
      const response = value as { decisions?: unknown } | null;
      if (
        response === null ||
        typeof response !== "object" ||
        !Array.isArray(response.decisions) ||
        response.decisions.length !== entries.length
      )
        throw invalid();
      const byItem = new Map<DocumentNormalizationCandidateItem, unknown>();
      for (const answer of response.decisions as { document?: unknown; sourcePath?: unknown }[]) {
        // The document reference and its source path must name the same document.
        const item = set.resolve(answer?.document, answer?.sourcePath);
        if (item === undefined || byItem.has(item)) throw invalid();
        byItem.set(item, answer);
      }
      return entries.map((entry) => decisionFor(entry, byItem.get(entry.item)));
    },
  };
}
