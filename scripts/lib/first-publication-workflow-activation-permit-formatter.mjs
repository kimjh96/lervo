export function formatFirstPublicationWorkflowActivationPermit(permit) {
  return [
    "CLI stage-only workflow 적용 허가 생성 완료",
    `대상: ${permit.target.repository}/${permit.target.workflow}`,
    "상태: 검토한 workflow bytes와 외부 보호 설정이 그대로일 때만 적용할 수 있습니다.",
    "",
    "이 명령은 workflow, npm·GitHub 설정과 package 게시 상태를 바꾸지 않았습니다.",
  ].join("\n") + "\n";
}
