import { providerOutputSchema } from "@lervo/schemas";
export { defaultEnglishWritingContract as practiceWritingContract } from "@lervo/core";

/** Provider-neutral procedure and exact review bindings for ADR-0543. */
export interface ReusablePractice {
  name: string;
  description: string;
  goal: string;
  whenToUse: string[];
  whenNotToUse: string[];
  inputs: string[];
  preconditions: string[];
  steps: string[];
  confirmation: string[];
  stopConditions: string[];
  verified: string[];
  assumptions: string[];
  sourcePaths: string[];
}

const text = { type: "string", minLength: 1, maxLength: 512 } as const;
const list = { type: "array", minItems: 1, maxItems: 12, items: text } as const;
export const reusablePracticeSchema = providerOutputSchema({
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", maxLength: 64 },
    description: text,
    goal: text,
    whenToUse: list,
    whenNotToUse: list,
    inputs: list,
    preconditions: list,
    steps: list,
    confirmation: list,
    stopConditions: list,
    verified: list,
    assumptions: { ...list, minItems: 0 },
    sourcePaths: { ...list, minItems: 0 },
  },
  required: [
    "name",
    "description",
    "goal",
    "whenToUse",
    "whenNotToUse",
    "inputs",
    "preconditions",
    "steps",
    "confirmation",
    "stopConditions",
    "verified",
    "assumptions",
    "sourcePaths",
  ],
} as const);

export function parseReusablePractice(value: unknown): ReusablePractice | null {
  if (value === null || value === undefined) return null;
  const item = value as Record<string, unknown>;
  if (
    typeof item !== "object" ||
    Array.isArray(item) ||
    Object.keys(item).sort().join() !== [...reusablePracticeSchema.required].sort().join()
  )
    throw new TypeError("Invalid practice fields.");
  for (const field of reusablePracticeSchema.required) {
    const v = item[field];
    if (["name", "description", "goal"].includes(field)) {
      if (typeof v !== "string" || !v.trim() || Buffer.byteLength(v) > 512)
        throw new TypeError("Invalid practice text.");
    } else if (
      !Array.isArray(v) ||
      v.length > 12 ||
      (!["assumptions", "sourcePaths"].includes(field) && v.length === 0) ||
      v.some((s) => typeof s !== "string" || !s.trim() || Buffer.byteLength(s) > 512)
    )
      throw new TypeError("Invalid practice procedure.");
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(String(item.name)) || String(item.name).length > 64)
    throw new TypeError("Invalid practice name.");
  if ((item.sourcePaths as string[]).some((p) => !safePracticePath(p)))
    throw new TypeError("Invalid practice source path.");
  if (Buffer.byteLength(JSON.stringify(item)) > 16 * 1024)
    throw new TypeError("Practice exceeds its bound.");
  return item as unknown as ReusablePractice;
}

export function safePracticePath(path: string): boolean {
  return (
    path.length <= 500 &&
    !/[\\:\0\n\r]/u.test(path) &&
    !path.split("/").some((p) => !p || p === "." || p === "..") &&
    ![".git", ".lervo/state"].some((p) => path === p || path.startsWith(`${p}/`))
  );
}

export interface PracticeReviewBinding {
  draftHash: string;
  evidenceHashes: string[];
  targetHash: string | null;
  catalogDigest: string;
}

export interface PracticeReview extends PracticeReviewBinding {
  reviewerAgentId: string;
  reviewerSessionId: string;
  decision: "accept" | "reject";
  reasonCode: "accepted" | "not_reusable" | "duplicate" | "incomplete" | "ungrounded";
}

export function practiceReviewValid(input: {
  expected: PracticeReviewBinding;
  review: PracticeReview;
  drafterAgentId: string;
  drafterSessionId: string;
}): boolean {
  const { expected, review } = input;
  return (
    review.reviewerAgentId !== input.drafterAgentId &&
    review.reviewerSessionId !== input.drafterSessionId &&
    review.draftHash === expected.draftHash &&
    review.targetHash === expected.targetHash &&
    review.catalogDigest === expected.catalogDigest &&
    JSON.stringify([...review.evidenceHashes].sort()) ===
      JSON.stringify([...expected.evidenceHashes].sort()) &&
    (review.decision === "accept"
      ? review.reasonCode === "accepted"
      : ["not_reusable", "duplicate", "incomplete", "ungrounded"].includes(review.reasonCode))
  );
}

export function renderPracticeSkill(practice: ReusablePractice): string {
  const sections = [
    ["Goal", [practice.goal]],
    ["When to use", practice.whenToUse],
    ["When not to use", practice.whenNotToUse],
    ["Inputs", practice.inputs],
    ["Preconditions", practice.preconditions],
    ["Steps", practice.steps],
    ["Confirm success", practice.confirmation],
    ["Stop conditions", practice.stopConditions],
    ["Verified", practice.verified],
    ["Assumptions", practice.assumptions],
    ["Sources", practice.sourcePaths],
  ] as const;
  const result =
    `---\nname: ${practice.name}\ndescription: ${JSON.stringify(practice.description)}\n---\n\n` +
    sections
      .map(
        ([title, values]) =>
          `## ${title}\n\n${values.map((v) => `- ${v}`).join("\n") || "None."}\n`,
      )
      .join("\n");
  if (Buffer.byteLength(result) > 8 * 1024) throw new TypeError("Skill draft exceeds 8 KiB.");
  return result;
}
