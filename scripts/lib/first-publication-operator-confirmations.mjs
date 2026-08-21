import { validateFirstPublicationBootstrapAuthorization } from
  "./first-publication-bootstrap-reader.mjs";

export const firstPublicationSecondFactorPhrase = "2FA 확인을 완료했습니다";

export function firstPublicationIntentPhrase(bootstrap) {
  validateFirstPublicationBootstrapAuthorization(bootstrap);
  return `${bootstrap.target.package}@${bootstrap.target.version}을 ` +
    "대화형 2FA로 한 번 게시하고 bypass token은 사용하지 않습니다";
}

export function firstPublicationOperatorConfirmations(bootstrap) {
  return [
    {
      id: "direct_publication_intent",
      timing: "before_reservation",
      phrase: firstPublicationIntentPhrase(bootstrap),
      declinedOutcome: "no_state_change",
    },
    {
      id: "second_factor_attestation",
      timing: "after_publication_attempt",
      phrase: firstPublicationSecondFactorPhrase,
      declinedOutcome: "publication_unknown_retry_forbidden",
    },
  ];
}
