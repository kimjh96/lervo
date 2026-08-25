import { validateFirstPublicationBootstrapAuthorization } from "./first-publication-bootstrap-reader.mjs";

export const firstPublicationSecondFactorPhrase = "I completed the 2FA confirmation";

export function firstPublicationIntentPhrase(bootstrap) {
  validateFirstPublicationBootstrapAuthorization(bootstrap);
  return (
    `I will publish ${bootstrap.target.package}@${bootstrap.target.version} once ` +
    "with interactive 2FA and will not use a bypass token"
  );
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
