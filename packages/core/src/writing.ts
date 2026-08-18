import { createHash } from "node:crypto";

import type {
  DeterministicWritingCheckId,
  WritingCheckResult,
  WritingContract,
  WritingEvaluation,
} from "@lervo/schemas";

export const defaultKoreanWritingContract = {
  schemaVersion: 1,
  writingPolicyId: "writing_ko-kr-human",
  locale: "ko-KR",
  surfaces: [
    "readme",
    "pull_request",
    "issue",
    "review_comment",
    "status",
    "chat",
    "documentation",
  ],
  audience: "mixed",
  informationOrder: {
    lead: "purpose_or_conclusion",
    then: ["reason", "change_or_result", "scope_and_impact", "next_action", "evidence"],
  },
  prose: {
    register: "polite",
    completeSentences: true,
    cohesiveParagraphs: true,
    oneMainFactPerSentence: true,
    avoidTranslationeseAndFragments: true,
  },
  terminology: {
    preserveMachineIdentifiers: true,
    explainInternalTermsAtFirstUse: true,
    preferConcreteVerbs: true,
    forbiddenVagueTerms: ["퀵스타트", "간판", "발사", "봉인"],
  },
  actions: {
    abstractActors: "forbid",
    stateObjectAndActionDirectly: true,
    stateWhenNoActionIsNeeded: true,
  },
  evidence: {
    majorClaimsRequireEvidence: true,
    distinguishRunFromNotRun: true,
    keepRawLogsOutOfPrimaryProse: true,
  },
  verification: {
    deterministicChecks: [
      "forbid_em_dash",
      "forbid_abstract_action_subject",
      "no_empty_sections",
      "forbid_vague_terms",
    ],
    semanticChecks: [
      {
        checkId: "natural_ko-kr_prose",
        requirement:
          "한국어 문장을 번역투나 명사 조각으로 나열하지 않고, 앞뒤 문장이 하나의 문단 맥락으로 자연스럽게 이어져야 합니다.",
        required: true,
      },
      {
        checkId: "plain_audience_language",
        requirement:
          "첫 화면에서는 내부 구현 용어보다 독자가 이해할 수 있는 업무 언어를 사용하고, 필요한 기술 용어는 처음 등장할 때 뜻을 설명해야 합니다.",
        required: true,
      },
      {
        checkId: "direct_result_and_action",
        requirement:
          "결과와 영향, 다음 행동을 구체적으로 설명하고 사람·사용자·담당자 같은 추상적인 행동 주체에 책임을 넘기지 않아야 합니다.",
        required: true,
      },
    ],
    semanticEvaluationMode: "separate_pass",
    requiresPassedEvaluation: true,
    failureDisposition: "block_publication",
  },
} as const satisfies WritingContract;

const abstractActionSubjectPatterns = [
  /(사람|사용자|담당자)(?:은|는|이|가) ?(?:직접 |최종 )?(?:확인|판단|처리|머지|편집|검토|결정|재검증)/g,
  /(사람|사용자|담당자) ?(?:직접 |최종 )?(?:확인|판단|처리|머지|편집|검토|결정|재검증)(?= ?(?:이|가|은|는|도)? ?(?:필요|대기|대상)| ?[.!?,)'"\]]| ?$)/gm,
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
    if (inFence || !/^#{1,6}\s+\S/.test(line)) {
      continue;
    }

    let nextContent = "";
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = (lines[cursor] ?? "").trim();
      if (candidate.length > 0) {
        nextContent = candidate;
        break;
      }
    }
    if (nextContent.length === 0 || /^#{1,6}\s+\S/.test(nextContent)) {
      emptySections += 1;
    }
  }

  return emptySections;
}

function countVagueTerms(text: string, terms: readonly string[]): number {
  return terms.reduce((count, term) => {
    if (term.length === 0) {
      return count;
    }
    return count + text.split(term).length - 1;
  }, 0);
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

export type WritingGateDecision =
  | {
      allowed: true;
      missingChecks: [];
      failedChecks: [];
    }
  | {
      allowed: false;
      failure: "writing_verification_failed";
      missingChecks: string[];
      failedChecks: string[];
      coordinateMismatch: boolean;
    };

export function evaluateWritingGate(input: {
  contract: WritingContract;
  evaluation: WritingEvaluation;
  artifactId: string;
  contentHash: string;
}): WritingGateDecision {
  const coordinateMismatch =
    input.evaluation.writingPolicyId !== input.contract.writingPolicyId ||
    input.evaluation.locale !== input.contract.locale ||
    input.evaluation.artifactId !== input.artifactId ||
    input.evaluation.contentHash !== input.contentHash;
  const requiredChecks = [
    ...input.contract.verification.deterministicChecks.map((checkId) => ({
      checkId,
      kind: "deterministic" as const,
    })),
    ...input.contract.verification.semanticChecks
      .filter((check) => check.required)
      .map((check) => ({ checkId: check.checkId, kind: "semantic" as const })),
  ];
  const missingChecks: string[] = [];
  const failedChecks: string[] = [];

  for (const required of requiredChecks) {
    const matches = input.evaluation.checks.filter(
      (check) => check.checkId === required.checkId && check.kind === required.kind,
    );
    if (matches.length !== 1) {
      missingChecks.push(required.checkId);
      continue;
    }
    const result = matches[0];
    if (!result || result.status !== "passed" || result.violationCount !== 0) {
      failedChecks.push(required.checkId);
    }
  }

  const hasSeparateSemanticEvaluator = input.evaluation.evaluators.some(
    (evaluator) =>
      (evaluator.kind === "model" || evaluator.kind === "human") &&
      evaluator.phase === "separate_pass",
  );
  if (!hasSeparateSemanticEvaluator) {
    missingChecks.push("semantic_evaluator");
  }

  if (
    coordinateMismatch ||
    missingChecks.length > 0 ||
    failedChecks.length > 0 ||
    input.evaluation.overallStatus !== "passed"
  ) {
    return {
      allowed: false,
      failure: "writing_verification_failed",
      missingChecks,
      failedChecks,
      coordinateMismatch,
    };
  }

  return { allowed: true, missingChecks: [], failedChecks: [] };
}
