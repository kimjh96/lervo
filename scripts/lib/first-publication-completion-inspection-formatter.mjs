export function formatFirstPublicationCompletionInspection() {
  return [
    "최초 게시 전환 기록을 확인했습니다.",
    "- Stage 증거 원본: 현재 manifest와 일치",
    "- 완료 근거: npm stage 승인 결과 대조와 연결됨",
    "- 남은 수동 조치: 없음",
    "- 현재 npm·GitHub 외부 상태: 이번 점검에서는 다시 조회하지 않음",
    "",
  ].join("\n");
}
