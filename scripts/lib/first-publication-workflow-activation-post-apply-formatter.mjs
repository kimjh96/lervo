export function formatFirstPublicationWorkflowActivationPostApplyReport() {
  return [
    "CLI stage-only workflow 사후 검증 완료",
    "- 현재 workflow 파일은 적용 영수증에 기록된 결과와 같습니다.",
    "- stage 게시 명령과 workflow의 권한·실행 조건이 제한된 구성으로 유지되고 있습니다.",
    "- npm stage 권한과 GitHub의 검토·태그 보호 설정을 다시 확인했습니다.",
    "",
    "이 검증은 적용 영수증의 발급 주체·서명이나 검토한 후보의 전체 이력을 확인하지 않습니다.",
    "또한 workflow가 GitHub에 배포·실행됐거나 npm stage 접수와 공개가 일어났다는 뜻이 아닙니다.",
    "파일, workflow, npm·GitHub 설정과 package 상태는 변경하지 않았습니다.",
  ].join("\n") + "\n";
}
