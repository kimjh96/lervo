const messages = Object.freeze({
  review_required: "검토 필요",
});

export function formatFirstPublicationWorkflowActivationCandidate(candidate) {
  const lines = [
    `CLI 최초 게시 workflow 활성화 후보: ${messages[candidate.status] ?? "확인 필요"}`,
    "- 기존 release workflow의 다른 내용은 그대로 두고 publish-cli job 하나만 추가합니다.",
    "- 새 job은 검증된 release 파일을 받아 npm-release 환경에서 stage publish만 실행합니다.",
    "- 직접 게시는 금지되며 registry token을 workflow에 넣지 않습니다.",
    "- 이 결과는 검토용 후보이므로 아직 원본 workflow에 적용할 수 없습니다.",
    "정확한 후보 파일은 --workflow-yaml로, 검토 metadata는 --json으로 확인할 수 있습니다.",
    "파일 수정, npm·GitHub 설정 변경, package 게시는 실행하지 않았습니다.",
  ];
  return `${lines.join("\n")}\n`;
}
