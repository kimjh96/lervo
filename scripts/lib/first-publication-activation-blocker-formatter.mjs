const checkLabels = {
  package_identity: "공개 CLI 패키지 이름·버전",
  repository_metadata: "저장소 정보",
  license_metadata: "라이선스",
  publication_metadata: "npm 게시 설정",
};

const reasonMessages = {
  package_name_mismatch: "package.json의 패키지 이름이 @lervo/cli이 아닙니다.",
  package_version_mismatch: "package.json과 release manifest의 버전이 다릅니다.",
  package_not_public: "package.json이 공개 패키지로 설정되지 않았습니다.",
  package_access_not_public: "package.json의 게시 범위가 public으로 설정되지 않았습니다.",
  package_repository_missing: "package.json에 GitHub 저장소가 없습니다.",
  package_repository_invalid: "package.json의 GitHub 저장소 형식이 올바르지 않습니다.",
  release_repository_missing: "release manifest에 GitHub 저장소가 없습니다.",
  release_repository_invalid: "release manifest의 GitHub 저장소 형식이 올바르지 않습니다.",
  repository_mismatch: "package.json과 release manifest의 저장소가 다릅니다.",
  package_license_unresolved: "package.json의 공개 라이선스가 정해지지 않았습니다.",
  release_license_unresolved: "release manifest의 공개 라이선스가 정해지지 않았습니다.",
  license_mismatch: "package.json과 release manifest의 라이선스가 다릅니다.",
  package_registry_unpinned: "package.json에 public npm registry가 고정되지 않았습니다.",
  release_registry_unpinned: "release manifest에 public npm registry가 고정되지 않았습니다.",
  package_provenance_unpinned: "package.json에서 provenance가 명시적으로 켜지지 않았습니다.",
  release_provenance_unpinned: "release manifest에서 provenance가 명시적으로 켜지지 않았습니다.",
};

const externalMessages = {
  public_package_availability: "public npm에서 @lervo/cli 이름을 사용할 수 있는지 확인해야 합니다.",
  npm_scope_control: "npm의 @lervo scope를 실제로 관리할 수 있는지 사람이 확인해야 합니다.",
  first_publication_approval:
    "라이선스, 패키지 이름, scope 권한, 최초 직접 게시 1회와 이후 전환을 묶은 별도 승인이 필요합니다.",
};

export function formatFirstPublicationActivationBlockerReport(report) {
  const lines = [
    "CLI 최초 게시 활성화 차단 항목",
    `대상: ${report.target.package}@${report.target.version}`,
    "상태: 아직 활성화할 수 없습니다. 게시 활성화 기능도 구현되어 있지 않습니다.",
    "",
    "로컬 파일에서 확인한 항목:",
  ];
  for (const item of report.localChecks) {
    lines.push(`- ${checkLabels[item.id] ?? item.id}: ${item.status === "ready" ? "문제 없음" : "해결 필요"}`);
    for (const reason of item.reasons) {
      lines.push(`  ${reasonMessages[reason] ?? "로컬 설정을 확인해야 합니다."}`);
    }
  }
  lines.push("", "로컬 파일만으로 확인할 수 없는 항목:");
  for (const item of report.externalRequirements) {
    lines.push(`- ${externalMessages[item.id] ?? "외부 확인이 필요합니다."}`);
  }
  lines.push(
    "",
    "이 명령은 온라인 확인, 파일 수정, 승인 생성, 게시 활성화나 패키지 게시를 실행하지 않았습니다.",
  );
  return `${lines.join("\n")}\n`;
}
