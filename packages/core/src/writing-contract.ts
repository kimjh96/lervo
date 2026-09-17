import type { WritingContract } from "@lervo/schemas";

export const supportedWritingLanguages = ["en"] as const;

export type SupportedWritingLanguage = (typeof supportedWritingLanguages)[number];

export const defaultEnglishWritingContract = {
  schemaVersion: 1,
  writingPolicyId: "writing_en-human",
  locale: "en",
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
    register: "plain_spec",
    completeSentences: true,
    cohesiveParagraphs: true,
    oneMainFactPerSentence: true,
    avoidTranslationeseAndFragments: true,
  },
  terminology: {
    preserveMachineIdentifiers: true,
    explainInternalTermsAtFirstUse: true,
    preferConcreteVerbs: true,
    forbiddenVagueTerms: ["quick win", "magic", "simply", "obviously"],
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
          "Write natural English prose in complete sentences, with each paragraph forming a coherent line of thought instead of a list of fragments.",
        required: true,
      },
      {
        checkId: "plain_audience_language",
        requirement:
          "Judge clarity for the supplied audience and prose register. A technical specification may use standard software terms, but it must explain repository-specific terms, uncommon abbreviations, and machine identifiers at first use or in a Terms section.",
        required: true,
      },
      {
        checkId: "direct_result_and_action",
        requirement:
          "State the result, impact, and next action concretely without assigning responsibility to an unspecified user, person, or owner.",
        required: true,
      },
    ],
    semanticEvaluationMode: "separate_pass",
    requiresPassedEvaluation: true,
    failureDisposition: "block_publication",
  },
} as const satisfies WritingContract;

export const fixedEnglishStatusWritingContract = {
  ...defaultEnglishWritingContract,
  writingPolicyId: "writing_en-fixed-status",
  surfaces: ["status", "chat"],
  verification: {
    ...defaultEnglishWritingContract.verification,
    semanticChecks: [],
    semanticEvaluationMode: "separate_pass",
  },
} as const satisfies WritingContract;

export const adaptiveConversationWritingContract = {
  ...defaultEnglishWritingContract,
  writingPolicyId: "writing_mul-conversation",
  locale: "mul",
  surfaces: ["chat"],
  prose: {
    ...defaultEnglishWritingContract.prose,
    register: "polite",
  },
  verification: {
    ...defaultEnglishWritingContract.verification,
    semanticChecks: [
      {
        checkId: "natural_conversation_prose",
        requirement:
          "Write natural, direct conversational prose in the selected response language, preserving machine identifiers and clearly separating observed facts from proposed actions.",
        required: true,
      },
    ],
  },
} as const satisfies WritingContract;

export const koreanConversationWritingContract = {
  ...adaptiveConversationWritingContract,
  writingPolicyId: "writing_ko-conversation",
  locale: "ko",
  verification: {
    ...adaptiveConversationWritingContract.verification,
    semanticChecks: [
      {
        checkId: "natural_ko_prose",
        requirement:
          "독자에게 직접 설명하는 자연스러운 한국어 완전문장으로 작성하고, 문단마다 하나의 응집된 논지를 유지한다.",
        required: true,
      },
      {
        checkId: "plain_audience_language",
        requirement:
          "표준 소프트웨어 용어는 사용할 수 있지만 저장소 전용 용어, 생소한 약어, 기계 식별자는 처음 등장할 때 독자가 이해할 수 있게 설명한다.",
        required: true,
      },
      {
        checkId: "direct_result_and_action",
        requirement:
          "결과, 영향, 다음 행동을 구체적으로 밝히고 불특정 사용자, 담당자, 사람 또는 팀에게 책임을 넘기지 않는다.",
        required: true,
      },
    ],
  },
} as const satisfies WritingContract;

export const realtimeConversationWritingContract = {
  ...adaptiveConversationWritingContract,
  writingPolicyId: "writing_mul-realtime-conversation",
  verification: {
    ...adaptiveConversationWritingContract.verification,
    semanticChecks: [],
  },
} as const satisfies WritingContract;

export const fixedConversationStatusWritingContract = {
  ...fixedEnglishStatusWritingContract,
  writingPolicyId: "writing_mul-fixed-conversation-status",
  locale: "mul",
  surfaces: ["chat"],
} as const satisfies WritingContract;

const writingContracts = {
  en: defaultEnglishWritingContract,
} as const satisfies Record<SupportedWritingLanguage, WritingContract>;

export function writingContractForLanguage(language: string): WritingContract {
  if (!supportedWritingLanguages.includes(language as SupportedWritingLanguage)) {
    throw new Error(`Unsupported writing publication language: ${language}`);
  }
  return structuredClone(writingContracts[language as SupportedWritingLanguage]);
}

export const defaultWritingContract = defaultEnglishWritingContract;
