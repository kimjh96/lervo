const checkLabels = {
  bootstrap_freshness: "승인 유효 시간",
  release_artifact: "게시 파일",
  public_package_absence: "공개 패키지 이름",
  reservation_state: "일회성 예약",
  npm_interactive_readiness: "npm 대화형 준비",
};

const reasonMessages = {
  check_precedes_observation: "점검 시각이 패키지 확인 시각보다 빠릅니다.",
  bootstrap_expired: "공개 패키지 이름을 확인한 결과의 유효 시간이 지났습니다.",
  artifact_unavailable: "게시할 패키지 파일을 안전하게 읽지 못했습니다.",
  artifact_changed: "게시할 패키지 파일이 승인된 파일과 다릅니다.",
  registry_unavailable: "public npm에서 패키지 존재 여부를 확인하지 못했습니다.",
  public_package_exists: "public npm에 같은 패키지가 이미 있습니다.",
  reservation_store_unavailable: "일회성 예약 저장 상태를 안전하게 읽지 못했습니다.",
  publication_already_reserved: "같은 최초 게시 승인이 이미 예약되었습니다.",
  publication_already_terminal: "같은 최초 게시 승인은 이미 종료 상태입니다.",
  terminal_not_interactive: "명령을 직접 입력하는 터미널에서 실행해야 합니다.",
  automation_environment_detected: "자동화 환경에서는 수동 최초 게시를 준비하지 않습니다.",
  registry_credential_in_environment: "환경 변수에 npm 인증 정보가 있어 사용을 중단했습니다.",
  npm_client_unavailable: "npm 명령을 실행하지 못했습니다.",
  npm_client_unsupported: "npm 11.5.1 이상이 필요합니다.",
  npm_profile_unavailable: "npm 계정의 2단계 인증 설정을 확인하지 못했습니다.",
  npm_write_2fa_not_ready: "npm 계정이 게시할 때도 2단계 인증을 요구하도록 설정되지 않았습니다.",
};

export function formatFirstPublicationPreflight(report) {
  const lines = [
    `CLI 최초 게시 사전 점검: ${report.status === "ready" ? "준비됨" : "차단됨"}`,
  ];
  for (const check of report.checks) {
    const status = check.status === "ready" ? "준비됨" :
      check.status === "unknown" ? "확인 불가" : "차단됨";
    lines.push(`- ${checkLabels[check.id] ?? check.id}: ${status}`);
    for (const reason of check.reasons) {
      lines.push(`  ${reasonMessages[reason] ?? "준비 조건을 확인하지 못했습니다."}`);
    }
  }
  lines.push(
    "이 결과는 실행 허가가 아닙니다. 예약을 만들거나 패키지를 게시하거나 외부 설정을 바꾸지 않았습니다.",
  );
  return `${lines.join("\n")}\n`;
}
