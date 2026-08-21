export function formatFirstPublicationWorkflowExecutionEvidence(report) {
  return [
    "CLI stage-only workflow 실행 증거: 확인됨",
    `- 대상: ${report.target.package}@${report.target.version}`,
    `- release tag: ${report.target.releaseTag}`,
    `- workflow run: #${report.github.run.runNumber}, attempt ${report.target.attempt}`,
    "- 실행 결과: workflow와 stage job이 모두 성공으로 종료됨",
    "- 결과 보존: run-attempt 전용 artifact metadata 확인됨",
    "- 아직 확인하지 않은 것: artifact 내용, npm stage 접수, 2FA 승인, 공개 배포",
    "- 변경 사항: 파일·GitHub 설정·workflow 실행·게시 변경 없음",
    "",
  ].join("\n");
}
