export interface DeliberationLanguagePack {
  locale: "en";
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

export function deliberationLanguageFor(locale: string): DeliberationLanguagePack {
  if (locale !== "en") {
    throw new Error(`Unsupported deliberation publication language: ${locale}`);
  }
  return englishDeliberationLanguage;
}
