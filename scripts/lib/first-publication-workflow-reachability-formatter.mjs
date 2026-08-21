export function formatFirstPublicationWorkflowReachabilityEvidence(report) {
  return [
    "CLI stage-only workflow ref 도달 가능성 확인 완료",
    `- Source commit은 현재 기본 브랜치 ${report.github.defaultBranch.name}에 포함됩니다.`,
    `- Release tag ${report.target.releaseTag}는 같은 source commit을 정확히 가리킵니다.`,
    "- 관측 중 기본 브랜치와 tag ref가 움직이지 않았습니다.",
    "",
    "이 결과는 관측 뒤 ref가 바뀌지 않는다는 보장이 아닙니다.",
    "Workflow 실행, npm stage 접수·2FA 승인과 package 공개도 확인하지 않았습니다.",
    "로컬 파일, GitHub 설정과 Git ref는 변경하지 않았습니다.",
  ].join("\n") + "\n";
}
