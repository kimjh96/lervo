export function formatFirstPublicationStageApprovalExecution(terminal) {
  return [
    "CLI npm stage 승인 명령 완료",
    "- npm CLI 결과: exit code 0",
    "- 공개 상태: 아직 별도 registry 검증이 필요함",
    "- 재시도: 금지",
    "- 기록: immutable attempt와 terminal 저장됨",
    "",
  ].join("\n");
}
