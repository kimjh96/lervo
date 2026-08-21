export function formatFirstPublicationWorkflowRemoteDeploymentEvidence() {
  return [
    "CLI stage-only workflow 원격 source 확인 완료",
    "- 지정한 GitHub commit에 현재 검증된 workflow와 같은 파일이 있습니다.",
    "- 원격 파일도 제한된 stage-only job 계약을 그대로 따릅니다.",
    "",
    "이 결과는 해당 commit이 기본 브랜치나 release tag에 포함됐다는 뜻이 아닙니다.",
    "Workflow 실행, npm stage 접수·2FA 승인과 package 공개도 확인하지 않았습니다.",
    "로컬 파일, GitHub 설정과 package 상태는 변경하지 않았습니다.",
  ].join("\n") + "\n";
}
