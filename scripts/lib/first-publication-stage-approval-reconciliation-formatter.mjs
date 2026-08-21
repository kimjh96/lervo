export function formatFirstPublicationStageApprovalReconciliation(report) {
  const outcomes = {
    public_release_confirmed: "exact public release와 stage 제거가 확인됨",
    approval_not_confirmed: "public release가 보이지 않고 승인 대상 stage가 남아 있음",
    unknown: "public release와 stage 상태가 일관된 결론에 이르지 못함",
  };
  return [
    "CLI npm stage 승인 결과 대조 완료",
    `- 대상: ${report.target.package}@${report.target.version}`,
    `- 결과: ${outcomes[report.outcome]}`,
    "- 재시도 권한: 없음",
    "- 변경 사항: attempt·terminal·npm stage를 변경하지 않음",
    "",
  ].join("\n");
}
