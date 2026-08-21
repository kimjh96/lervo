export function formatFirstPublicationWorkflowActivationApply(result) {
  if (result.status === "rolled_back") {
    return "중단된 CLI stage-only workflow 적용을 원본으로 복구했습니다.\n";
  }
  if (result.status === "committed_cleanup_completed") {
    return "완료된 CLI stage-only workflow 적용의 복구 기록을 정리했습니다.\n";
  }
  return [
    "CLI stage-only workflow 적용 완료",
    "상태: publish-cli job이 exact 검토 후보로 활성화되었습니다.",
    "npm·GitHub 외부 설정은 읽기만 했고 package 게시를 실행하지 않았습니다.",
  ].join("\n") + "\n";
}
