import { referencingArraySchema, reviewReferences, sha256 } from "@lervo/repository-knowledge";

import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import {
  contextCitationProperties,
  contextDocumentReferences,
  contextDocumentView,
} from "./review-context-references.js";
import { providerOutputSchema } from "@lervo/schemas";

/** The most bytes one canonical document draft may hold. */
const MAX_DRAFT_CONTENT_BYTES = 128 * 1024;

export interface CanonicalAssessmentSource {
  path: string;
  contentHash: string;
  kind: "text" | "opaque";
  content?: string;
}
export interface CanonicalDraft {
  path: string;
  beforeHash: string | null;
  content: string;
}
export interface CanonicalAssessment {
  decisions: {
    path: string;
    contentHash: string;
    disposition: "no_change" | "covered" | "candidate" | "needs_review";
    rationale: string;
    canonicalReferences: { path: string; contentHash: string; quote: string }[];
  }[];
  drafts: CanonicalDraft[];
}

const dispositions = ["no_change", "covered", "candidate", "needs_review"] as const;

/** An existing draft target whose exact bytes a retry shows the generator. */
export interface CanonicalDraftTarget {
  path: string;
  contentHash: string;
  content: string | null;
}

/**
 * ADR-0604: one assessment call's contract, shared by the request and the parser. The generator
 * sees each source as `s<n>` and each context document as `c<n>`, both paired with their paths,
 * and the schema allows only those references. A draft names only its path and bytes: Lervo derives
 * its `beforeHash` from the captured snapshot, and accepts an existing target only when this call
 * showed its exact bytes. `parse` maps references back to the exact hashes.
 */
export function canonicalAssessmentContract(input: {
  sources: readonly CanonicalAssessmentSource[];
  context: readonly {
    path: string;
    role: "instruction" | "canonical_candidate";
    contentHash: string;
    content: string;
  }[];
  capturedSources: readonly { path: string; contentHash: string }[];
  draftTargets?: readonly CanonicalDraftTarget[];
}) {
  if (input.sources.length === 0) throw new RangeError("An assessment needs at least one source.");
  const sources = reviewReferences(input.sources, { prefix: "s", path: (source) => source.path });
  const context = contextDocumentReferences(input.context);
  const citation = contextCitationProperties(context);
  const draftTargets = input.draftTargets ?? [];
  const schema = providerOutputSchema({
    type: "object",
    additionalProperties: false,
    properties: {
      decisions: {
        type: "array",
        minItems: input.sources.length,
        maxItems: input.sources.length,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            source: sources.schema,
            sourcePath: sources.pathSchema,
            disposition: { enum: dispositions },
            rationale: { type: "string", minLength: 80, maxLength: 4096 },
            canonicalReferences: referencingArraySchema(
              citation === null
                ? null
                : {
                    type: "object",
                    additionalProperties: false,
                    // ADR-0604: literal names, so the provider schema guard reads each one.
                    properties: {
                      document: citation.document,
                      path: citation.path,
                      quote: { type: "string", minLength: 20, maxLength: 2048 },
                    },
                    required: ["document", "path", "quote"],
                  },
              { maxItems: 8 },
            ),
          },
          required: ["source", "sourcePath", "disposition", "rationale", "canonicalReferences"],
        },
      },
      drafts: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string" },
            content: { type: "string", minLength: 1, maxLength: MAX_DRAFT_CONTENT_BYTES },
          },
          required: ["path", "content"],
        },
      },
    },
    required: ["decisions", "drafts"],
  });
  // The exact target bytes this call shows, by path and hash: sources, context and retry targets.
  const shown = new Set(
    [
      ...input.sources.filter((source) => source.content !== undefined),
      ...input.context,
      ...draftTargets.filter((target) => target.content !== null),
    ].map((item) => `${item.path}\0${item.contentHash}`),
  );
  const captured = new Map(
    input.capturedSources.map((source) => [source.path, source.contentHash]),
  );
  return {
    schema,
    view: {
      sources: input.sources.map(({ contentHash: _hash, ...source }, index) => ({
        source: sources.reference(index),
        ...source,
      })),
      context: contextDocumentView(context),
      ...(input.draftTargets === undefined
        ? {}
        : {
            existingDraftTargets: draftTargets.map(({ path, content }) => ({ path, content })),
          }),
    },
    parse: (value: unknown): CanonicalAssessment => {
      const fail = () => {
        throw new KnowledgeConvergenceRuntimeError("knowledge_semantic_review_invalid");
      };
      const result = value as { decisions?: unknown; drafts?: unknown } | null;
      if (
        result === null ||
        typeof result !== "object" ||
        !Array.isArray(result.decisions) ||
        !Array.isArray(result.drafts) ||
        result.drafts.length > 8 ||
        result.decisions.length !== input.sources.length
      )
        return fail();
      const decisions = new Map<
        CanonicalAssessmentSource,
        CanonicalAssessment["decisions"][number]
      >();
      for (const raw of result.decisions as unknown[]) {
        const answer = raw as Record<string, unknown> | null;
        const source = sources.resolve(answer?.source, answer?.sourcePath);
        if (
          answer === null ||
          source === undefined ||
          decisions.has(source) ||
          typeof answer.rationale !== "string" ||
          answer.rationale.trim().length < 80 ||
          answer.rationale.length > 4096 ||
          !Array.isArray(answer.canonicalReferences) ||
          answer.canonicalReferences.length > 8 ||
          !dispositions.includes(answer.disposition as (typeof dispositions)[number])
        )
          return fail();
        const disposition = answer.disposition as (typeof dispositions)[number];
        const canonicalReferences = (answer.canonicalReferences as unknown[]).map((item) => {
          const reference = item as { document?: unknown; path?: unknown; quote?: unknown } | null;
          const target = context.resolve(reference?.document, reference?.path);
          if (
            target === undefined ||
            typeof reference?.quote !== "string" ||
            reference.quote.length < 20 ||
            !target.content.includes(reference.quote)
          )
            return fail();
          return { path: target.path, contentHash: target.contentHash, quote: reference.quote };
        });
        if (disposition === "covered" && canonicalReferences.length === 0) return fail();
        if (disposition === "candidate" && result.drafts.length === 0) return fail();
        if (source.kind === "opaque" && disposition !== "needs_review") return fail();
        decisions.set(source, {
          path: source.path,
          contentHash: source.contentHash,
          disposition,
          rationale: answer.rationale,
          canonicalReferences,
        });
      }
      const drafts = (result.drafts as unknown[]).map((raw) => {
        const draft = raw as { path?: unknown; content?: unknown } | null;
        if (
          draft === null ||
          typeof draft !== "object" ||
          typeof draft.path !== "string" ||
          typeof draft.content !== "string" ||
          !draft.content.trim() ||
          Buffer.byteLength(draft.content) > MAX_DRAFT_CONTENT_BYTES
        )
          return fail();
        const beforeHash = captured.get(draft.path) ?? null;
        // An existing target is replaced only from bytes this call showed, and only by new bytes.
        if (
          beforeHash !== null &&
          (!shown.has(`${draft.path}\0${beforeHash}`) || beforeHash === sha256(draft.content))
        )
          return fail();
        return { path: draft.path, beforeHash, content: draft.content };
      });
      if (new Set(drafts.map((draft) => draft.path)).size !== drafts.length) return fail();
      return { decisions: input.sources.map((source) => decisions.get(source)!), drafts };
    },
  };
}
