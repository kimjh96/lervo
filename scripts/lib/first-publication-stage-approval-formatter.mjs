export function formatFirstPublicationStageApprovalAuthorization(authorization) {
  return [
    "CLI npm stage 승인 권한 생성 완료",
    `- 대상: ${authorization.target.package}@${authorization.target.version}`,
    "- 권한: 검토한 exact stage에 대화형 2FA approve 1회",
    `- 만료: ${authorization.validity.expiresAt}`,
    "- 주의: 아직 npm approve·reject·공개 확인을 실행하지 않았습니다",
    "",
  ].join("\n");
}
