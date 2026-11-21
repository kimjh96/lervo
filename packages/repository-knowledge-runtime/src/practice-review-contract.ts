import {
  nullableReviewEnum,
  parseReusablePractice,
  reusablePracticeSchema,
  ReviewAnswerInvalidError,
  reviewReferences,
  type PracticeReview,
  type PracticeReviewBinding,
  type ReusablePractice,
} from "@lervo/repository-knowledge";

import type { disclosePracticeCatalog } from "./practice-catalog.js";
import { providerOutputSchema } from "@lervo/schemas";

type DisclosedCatalog = Pick<ReturnType<typeof disclosePracticeCatalog>, "skills" | "rules">;
type CatalogSkill = DisclosedCatalog["skills"][number];

const overlaps = ["already_covered", "partial_overlap", "conflict", "new"] as const;
const reasonCodes = ["not_reusable", "duplicate", "incomplete", "ungrounded"] as const;

function record(value: unknown, keys: readonly string[], what: string): Record<string, unknown> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== [...keys].sort().join()
  )
    throw new ReviewAnswerInvalidError(`the ${what} answer has other fields than its schema`);
  return value as Record<string, unknown>;
}

/** A new or partial-overlap answer drafts a procedure; the others draft none. */
export type PracticeDraftAnswer =
  | { overlap: "already_covered"; target: CatalogSkill | null; practice: null }
  | { overlap: "conflict"; target: CatalogSkill | null; practice: null }
  | { overlap: "new"; target: null; practice: ReusablePractice }
  | { overlap: "partial_overlap"; target: CatalogSkill; practice: ReusablePractice };

/** ADR-0604: the catalog as a provider sees it: each skill as `t<n>` with its path, no hashes. */
export function practiceCatalogView(catalog: DisclosedCatalog) {
  return {
    skills: catalog.skills.map(({ contentHash: _hash, ...skill }, index) => ({
      target: `t${index + 1}`,
      ...skill,
    })),
    rules: catalog.rules.map(({ contentHash: _hash, ...rule }) => rule),
  };
}

/**
 * ADR-0604: the practice draft's contract, shared by the request and the parser. The drafter sees
 * each catalog skill as `t<n>` with its path and no content hash, and names a target by both. The
 * parser maps them back to the exact skill and throws on any answer that breaks the contract: a
 * target that is missing, mispaired or not allowed for the overlap, or a procedure that is
 * malformed, misnamed, cites a path outside the evidence, or comes with an overlap that drafts none.
 */
export function practiceDraftContract(input: {
  catalog: DisclosedCatalog;
  evidencePaths: readonly string[];
}) {
  const skills = reviewReferences(input.catalog.skills, {
    prefix: "t",
    path: (skill) => skill.path,
  });
  const schema = providerOutputSchema({
    type: "object",
    additionalProperties: false,
    properties: {
      overlap: { enum: overlaps },
      target: nullableReviewEnum(skills.references),
      targetPath: nullableReviewEnum(input.catalog.skills.map((skill) => skill.path)),
      practice: { anyOf: [{ type: "null" }, reusablePracticeSchema] },
    },
    required: ["overlap", "target", "targetPath", "practice"],
  });
  const view = practiceCatalogView(input.catalog);
  const parse = (value: unknown): PracticeDraftAnswer => {
    const answer = record(value, schema.required, "practice draft");
    const overlap = answer.overlap as PracticeDraftAnswer["overlap"];
    if (!overlaps.includes(overlap))
      throw new ReviewAnswerInvalidError("the practice overlap is unknown");
    let target: CatalogSkill | null = null;
    if (answer.target !== null || answer.targetPath !== null) {
      target = skills.resolve(answer.target, answer.targetPath) ?? null;
      if (target === null)
        throw new ReviewAnswerInvalidError("the practice target names no single catalog skill");
    }
    if (overlap === "already_covered" || overlap === "conflict") {
      if (answer.practice !== null)
        throw new ReviewAnswerInvalidError(`a ${overlap} practice drafts no procedure`);
      return { overlap, target, practice: null };
    }
    let practice: ReusablePractice | null;
    try {
      practice = parseReusablePractice(answer.practice);
    } catch {
      practice = null;
    }
    if (
      practice === null ||
      (target !== null && practice.name !== target.name) ||
      practice.sourcePaths.some((path) => !input.evidencePaths.includes(path))
    )
      throw new ReviewAnswerInvalidError("the practice procedure is malformed or ungrounded");
    // A partial overlap extends one named skill; a new practice names none.
    if (overlap === "partial_overlap" && target !== null) return { overlap, target, practice };
    if (overlap === "new" && target === null) return { overlap, target, practice };
    throw new ReviewAnswerInvalidError(`a ${overlap} practice names the wrong target`);
  };
  return { schema, view, parse };
}

/**
 * ADR-0604: the independent practice review's contract. The reviewer answers only a decision and a
 * reason code; Lervo attaches the exact draft, evidence, target and catalog binding at parse, so
 * the reviewer never copies a hash. A well-formed rejection is a verdict; anything else throws.
 */
export function practiceReviewContract(binding: PracticeReviewBinding) {
  const schema = providerOutputSchema({
    type: "object",
    additionalProperties: false,
    properties: {
      decision: { enum: ["accept", "reject"] },
      reasonCode: { enum: ["accepted", ...reasonCodes] },
    },
    required: ["decision", "reasonCode"],
  });
  const parse = (
    value: unknown,
    reviewer: { agentId: string; sessionId: string },
  ): PracticeReview => {
    const answer = record(value, schema.required, "practice review");
    const valid =
      answer.decision === "accept"
        ? answer.reasonCode === "accepted"
        : answer.decision === "reject" &&
          reasonCodes.includes(answer.reasonCode as (typeof reasonCodes)[number]);
    if (!valid) throw new ReviewAnswerInvalidError("the practice review verdict is malformed");
    return {
      ...binding,
      evidenceHashes: [...binding.evidenceHashes],
      reviewerAgentId: reviewer.agentId,
      reviewerSessionId: reviewer.sessionId,
      decision: answer.decision as PracticeReview["decision"],
      reasonCode: answer.reasonCode as PracticeReview["reasonCode"],
    };
  };
  return { schema, parse };
}

/**
 * ADR-0604: the unused-skill re-evaluation's contract. The reviewer answers only keep or retire;
 * Lervo binds the exact skill version and catalog itself. A malformed answer throws, so it never
 * reads as a keep or a retirement.
 */
export function practiceUsageReviewContract() {
  const schema = providerOutputSchema({
    type: "object",
    additionalProperties: false,
    properties: { decision: { enum: ["keep", "retire"] } },
    required: ["decision"],
  });
  const parse = (value: unknown): "keep" | "retire" => {
    const answer = record(value, schema.required, "practice usage review");
    if (answer.decision !== "keep" && answer.decision !== "retire")
      throw new ReviewAnswerInvalidError("the practice usage verdict is malformed");
    return answer.decision;
  };
  return { schema, parse };
}
