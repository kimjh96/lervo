import type { WritingContract } from "@lervo/schemas";

export const writingPolicyFixture = {
  schemaVersion: 1,
  writingPolicyId: "writing_en-human",
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
    forbiddenVagueTerms: ["quick start", "flagship", "launch", "seal"],
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
        checkId: "natural_en_prose",
        requirement:
          "English sentences must flow naturally in paragraph context without translation-like phrasing or noun fragments.",
        required: true,
      },
    ],
    semanticEvaluationMode: "separate_pass",
    requiresPassedEvaluation: true,
    failureDisposition: "block_publication",
  },
} as const satisfies WritingContract;
