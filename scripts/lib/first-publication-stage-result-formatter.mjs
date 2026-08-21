export function formatFirstPublicationStageResultEvidence(report) {
  return [
    "CLI npm stage 결과 증거: 확인됨",
    `- 대상: ${report.target.package}@${report.target.version}`,
    `- workflow run ID: ${report.target.runId}, attempt ${report.target.attempt}`,
    "- artifact: 전체 archive digest와 내부 attempt·terminal 문서 확인됨",
    "- stage 결과: npm CLI가 stage 요청을 exit code 0으로 마쳤다고 기록됨",
    "- 주의: registry의 독립 접수 증명이나 2FA 승인이 아닙니다",
    "- 공개 상태: 확인하지 않음",
    "- 변경 사항: 읽기 전용 artifact download 외 변경 없음",
    "",
  ].join("\n");
}
