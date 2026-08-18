import type { WritingContract } from "@lervo/schemas";

export const writingPolicyFixture = {
  schemaVersion: 1,
  writingPolicyId: "writing_ko-kr-human",
  locale: "ko-KR",
  surfaces: ["chat", "documentation"],
  audience: "mixed",
  informationOrder: {
    lead: "purpose_or_conclusion",
    then: ["reason", "change_or_result", "next_action", "evidence"],
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
          "한국어 문장을 번역투나 명사 조각으로 나열하지 않고 문단 맥락이 자연스럽게 이어져야 합니다.",
        required: true,
      },
    ],
    semanticEvaluationMode: "separate_pass",
    requiresPassedEvaluation: true,
    failureDisposition: "block_publication",
  },
} as const satisfies WritingContract;
