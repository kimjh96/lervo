import { createHash } from "node:crypto";

import type {
  DeterministicWritingCheckId,
  WritingCheckResult,
  WritingContract,
} from "@lervo/schemas";

const abstractActionSubjectPatterns = [
  /\b(?:the )?(?:user|person|owner|someone) (?:must|needs? to|should) (?:check|decide|handle|merge|edit|review|verify)\b/gi,
  /\b(?:user|human|owner) (?:confirmation|decision|review|verification) (?:is )?(?:needed|required|pending)\b/gi,
];

function digestEvidence(checkId: string, text: string): string {
  return `sha256:${createHash("sha256").update(checkId).update("\0").update(text).digest("hex")}`;
}

function countPattern(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

function countEmptyMarkdownSections(text: string): number {
  const lines = text.split(/\r?\n/);
  let inFence = false;
  let emptySections = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !/^#{1,6}\s+\S/.test(line)) continue;

    let nextContent = "";
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = (lines[cursor] ?? "").trim();
      if (candidate.length > 0) {
        nextContent = candidate;
        break;
      }
    }
    if (nextContent.length === 0 || /^#{1,6}\s+\S/.test(nextContent)) emptySections += 1;
  }

  return emptySections;
}

function countVagueTerms(text: string, terms: readonly string[]): number {
  return terms.reduce(
    (count, term) => count + (term.length === 0 ? 0 : text.split(term).length - 1),
    0,
  );
}

type DeterministicWritingCheck = (text: string, contract: WritingContract) => number;

const deterministicWritingChecks = {
  forbid_em_dash: (text) => countPattern(text, /—/g),
  forbid_abstract_action_subject: (text) =>
    abstractActionSubjectPatterns.reduce(
      (count, pattern) => count + countPattern(text, pattern),
      0,
    ),
  no_empty_sections: (text) => countEmptyMarkdownSections(text),
  forbid_vague_terms: (text, contract) =>
    countVagueTerms(text, contract.terminology.forbiddenVagueTerms),
} satisfies Record<DeterministicWritingCheckId, DeterministicWritingCheck>;

export function lintDeterministicWriting(
  text: string,
  contract: WritingContract,
): WritingCheckResult[] {
  return contract.verification.deterministicChecks.map((checkId) => {
    const count = deterministicWritingChecks[checkId](text, contract);
    return {
      checkId,
      kind: "deterministic",
      status: count === 0 ? "passed" : "failed",
      violationCount: count,
      evidenceDigest: digestEvidence(checkId, text),
    };
  });
}
