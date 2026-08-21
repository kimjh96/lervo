const outcomeMessages = {
  published: "승인된 게시물이 public npm에서 확인됨",
  not_observed: "승인된 게시물이 public npm에서 확인되지 않음",
  unknown: "public npm 정보만으로 결과를 확정할 수 없음",
};

const checkLabels = {
  exact_version: "정확한 버전과 게시 파일",
  target_dist_tag: "대상 dist-tag",
};

const statusMessages = {
  matched: "일치",
  not_observed: "확인되지 않음",
  unknown: "판정 불가",
};

const reasonMessages = {
  registry_unavailable: "public npm 응답을 안전하게 확인하지 못했습니다.",
  target_version_not_observed: "대상 버전의 metadata가 보이지 않습니다.",
  exact_release_mismatch: "대상 버전에 승인된 게시 파일과 다른 metadata가 보입니다.",
  target_dist_tag_not_observed: "대상 dist-tag가 승인된 버전을 가리키지 않습니다.",
};

export function formatFirstPublicationReconciliation(report) {
  const lines = [
    `CLI 최초 게시 결과 대조: ${outcomeMessages[report.outcome] ?? "판정 불가"}`,
  ];
  for (const check of report.checks) {
    lines.push(
      `- ${checkLabels[check.id] ?? check.id}: ${statusMessages[check.status] ?? "판정 불가"}`,
    );
    for (const reason of check.reasons) {
      lines.push(`  ${reasonMessages[reason] ?? "결과를 안전하게 판정하지 못했습니다."}`);
    }
  }
  lines.push(
    "이 보고서는 기존 예약과 종료 기록을 바꾸지 않습니다. 결과와 관계없이 자동 재시도하거나 게시 완료로 전환하지 않았습니다.",
  );
  return `${lines.join("\n")}\n`;
}
