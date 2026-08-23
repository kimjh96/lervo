export function formatFirstPublicationStageApprovalAuthorization(authorization) {
  return [
    "CLI npm stage approval authorization created",
    `- Target: ${authorization.target.package}@${authorization.target.version}`,
    "- Authority: one interactive 2FA approval for the exact reviewed stage",
    `- Expires: ${authorization.validity.expiresAt}`,
    "- Caution: npm approve, reject, and public-status checks have not been performed",
    "",
  ].join("\n");
}
