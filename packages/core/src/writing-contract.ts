import type { WritingContract } from "@lervo/schemas";

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
