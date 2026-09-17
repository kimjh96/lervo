export interface DeliberationLanguagePack {
  locale: "en" | "ko";
  verdict: {
    approved: string;
    revisionRequired: string;
  };
  roles: {
    proposerName: string;
    proposerDescription: string;
    reviewerName: string;
    reviewerDescription: string;
    evaluatorName: string;
    evaluatorDescription: string;
  };
}

const englishDeliberationLanguage = {
  locale: "en",
  verdict: {
    approved: "Verdict: approved",
    revisionRequired: "Verdict: revision required",
  },
  roles: {
    proposerName: "Proposal and decision",
    proposerDescription: "Produces evidence-backed proposals, revisions, and the final decision.",
    reviewerName: "Independent review and verification",
    reviewerDescription:
      "Reviews proposals independently and explains repository verification results.",
    evaluatorName: "English writing evaluator",
    evaluatorDescription:
      "Evaluates whether publishable text satisfies the writing contract in a separate pass.",
  },
} as const satisfies DeliberationLanguagePack;

const koreanDeliberationLanguage = {
  locale: "ko",
  verdict: {
    approved: "판정: 승인",
    revisionRequired: "판정: 수정 필요",
  },
  roles: {
    proposerName: "제안 및 결정",
    proposerDescription: "근거에 기반한 제안, 수정안, 최종 결정을 작성합니다.",
    reviewerName: "독립 검토 및 검증",
    reviewerDescription: "제안을 독립적으로 검토하고 저장소 검증 결과를 설명합니다.",
    evaluatorName: "한국어 작성 평가자",
    evaluatorDescription: "게시 가능한 글이 작성 계약을 충족하는지 별도로 평가합니다.",
  },
} as const satisfies DeliberationLanguagePack;

export function deliberationLanguageFor(locale: string): DeliberationLanguagePack {
  if (locale === "en") return englishDeliberationLanguage;
  if (locale === "ko") return koreanDeliberationLanguage;
  throw new Error(`Unsupported deliberation publication language: ${locale}`);
}
