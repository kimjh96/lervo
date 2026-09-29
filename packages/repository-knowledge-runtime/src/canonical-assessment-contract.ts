import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { sha256 } from "@lervo/repository-knowledge";

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
export const canonicalAssessmentSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    decisions: {
      type: "array",
      minItems: 1,
      maxItems: 32,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string" },
          contentHash: { type: "string" },
          disposition: { enum: ["no_change", "covered", "candidate", "needs_review"] },
          rationale: { type: "string", minLength: 80, maxLength: 4096 },
          canonicalReferences: {
            type: "array",
            maxItems: 8,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                path: { type: "string" },
                contentHash: { type: "string" },
                quote: { type: "string", minLength: 20, maxLength: 2048 },
              },
              required: ["path", "contentHash", "quote"],
            },
          },
        },
        required: ["path", "contentHash", "disposition", "rationale", "canonicalReferences"],
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
          beforeHash: { type: ["string", "null"] },
          content: { type: "string", minLength: 1, maxLength: 131072 },
        },
        required: ["path", "beforeHash", "content"],
      },
    },
  },
  required: ["decisions", "drafts"],
} as const;

export function parseCanonicalAssessment(
  value: unknown,
  sources: CanonicalAssessmentSource[],
  context: { path: string; contentHash: string; content: string }[],
): CanonicalAssessment {
  const result = value as CanonicalAssessment | null;
  const fail = () => {
    throw new KnowledgeConvergenceRuntimeError("knowledge_semantic_review_invalid");
  };
  if (
    !result ||
    !Array.isArray(result.decisions) ||
    !Array.isArray(result.drafts) ||
    result.drafts.length > 8 ||
    result.decisions.length !== sources.length ||
    new Set(result.decisions.map((item) => item?.path)).size !== sources.length
  )
    return fail();
  for (const source of sources) {
    const decision = result.decisions.find((item) => item?.path === source.path);
    if (
      !decision ||
      decision.contentHash !== source.contentHash ||
      typeof decision.rationale !== "string" ||
      decision.rationale.trim().length < 80 ||
      decision.rationale.length > 4096 ||
      !Array.isArray(decision.canonicalReferences) ||
      !["no_change", "covered", "candidate", "needs_review"].includes(decision.disposition)
    )
      return fail();
    if (decision.disposition === "covered" && !decision.canonicalReferences.length) return fail();
    for (const reference of decision.canonicalReferences) {
      const target = context.find(
        (item) => item.path === reference?.path && item.contentHash === reference.contentHash,
      );
      if (
        !target ||
        typeof reference.quote !== "string" ||
        reference.quote.length < 20 ||
        !target.content.includes(reference.quote)
      )
        return fail();
    }
    if (decision.disposition === "candidate" && !result.drafts.length) return fail();
    if (source.kind === "opaque" && decision.disposition !== "needs_review") return fail();
  }
  if (
    new Set(result.drafts.map((draft) => draft?.path)).size !== result.drafts.length ||
    result.drafts.some(
      (draft) =>
        !draft ||
        typeof draft.path !== "string" ||
        typeof draft.content !== "string" ||
        !draft.content.trim() ||
        Buffer.byteLength(draft.content) > 131072 ||
        (draft.beforeHash !== null &&
          (!/^sha256:[a-f0-9]{64}$/u.test(draft.beforeHash) ||
            draft.beforeHash === sha256(draft.content))),
    )
  )
    return fail();
  return result;
}
