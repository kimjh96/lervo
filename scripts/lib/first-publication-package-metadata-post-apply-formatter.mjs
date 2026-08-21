const externalMessages = {
  license_approval: "선택한 라이선스를 공개 배포에 사용할 수 있다는 승인이 필요합니다.",
  public_package_availability: "public npm에서 패키지 이름을 사용할 수 있는지 확인해야 합니다.",
  scope_control_confirmation: "npm의 @lervo scope를 실제로 관리할 수 있는지 확인해야 합니다.",
  first_publication_approval: "최초 직접 게시 1회와 이후 게시 경로 전환을 묶은 승인이 필요합니다.",
};

export function formatFirstPublicationPackageMetadataPostApplyReport(report) {
  const lines = [
    "CLI 최초 게시 package metadata 사후 검증 완료",
    "- 현재 package.json은 적용 영수증의 결과와 일치합니다.",
    "- release manifest는 현재 package metadata로 다시 만든 결과와 일치합니다.",
    "- release SBOM은 현재 manifest와 lockfile에 맞습니다.",
    "- 로컬 metadata 차단 항목은 모두 해소되었습니다.",
    "",
    "아직 별도로 확인하거나 승인할 항목:",
  ];
  for (const item of report.externalRequirements) {
    lines.push(`- ${externalMessages[item.id] ?? "외부 확인이 필요합니다."}`);
  }
  lines.push(
    "",
    "영수증의 서명이나 발급 주체는 확인하지 않았습니다.",
    "파일 수정, 온라인 확인, 승인 생성, 게시 활성화와 패키지 게시는 실행하지 않았습니다.",
  );
  return `${lines.join("\n")}\n`;
}
