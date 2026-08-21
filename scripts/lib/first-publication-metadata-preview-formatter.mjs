import { formatFirstPublicationMetadataChange } from
  "./first-publication-metadata-change-formatter.mjs";

const requirementMessages = {
  license_approval: "선택한 라이선스의 공개 배포 적합성을 별도로 승인해야 합니다.",
  public_package_availability: "public npm에서 @lervo/cli 이름을 사용할 수 있는지 확인해야 합니다.",
  scope_control_confirmation: "npm의 @lervo scope를 실제로 관리할 수 있는지 확인해야 합니다.",
  first_publication_approval: "최초 직접 게시 1회와 이후 stage-only 전환을 별도로 승인해야 합니다.",
};

export function formatFirstPublicationMetadataPreview(preview) {
  const scopeKind = preview.target.scopeOwner.kind === "organization" ? "조직" : "사용자";
  const lines = [
    "CLI 최초 게시 metadata 변경 미리보기",
    `대상: ${preview.target.package}@${preview.target.version}`,
    `선택한 저장소: ${preview.target.repository}`,
    `선택한 라이선스: ${preview.target.license}`,
    `선택한 npm scope owner: ${scopeKind} ${preview.target.scopeOwner.name}`,
    "이 선택은 게시 승인이 아닙니다.",
    "",
    "package.json 변경:",
  ];
  if (preview.packageManifestChanges.length === 0) {
    lines.push("- 필요한 변경이 없습니다.");
  } else {
    for (const change of preview.packageManifestChanges) {
      lines.push(`- ${formatFirstPublicationMetadataChange(change, { currentState: true })}`);
    }
  }
  lines.push("", "release manifest:");
  lines.push(preview.releaseManifestRegeneration.status === "required"
    ? "- package metadata를 반영해 다시 만들어야 합니다. 생성 파일을 직접 고치면 안 됩니다."
    : "- 현재 선택과 같아 다시 만들 필요가 없습니다.");
  lines.push("", "아직 필요한 외부 확인과 승인:");
  for (const requirement of preview.remainingRequirements) {
    lines.push(`- ${requirementMessages[requirement.id] ?? "별도 확인이 필요합니다."}`);
  }
  lines.push(
    "",
    "이 명령은 온라인 확인, 파일 수정, release manifest 재생성, 승인 생성, 게시 활성화나 패키지 게시를 실행하지 않았습니다.",
  );
  return `${lines.join("\n")}\n`;
}
