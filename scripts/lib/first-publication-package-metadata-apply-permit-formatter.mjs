export function formatFirstPublicationPackageMetadataApplyPermit(permit) {
  const scopeKind = permit.selection.scopeOwner.kind === "organization" ? "조직" : "사용자";
  const lines = [
    "CLI 최초 게시 package.json 적용 허가",
    `대상: ${permit.target.package}@${permit.target.version}`,
    `검토한 저장소: ${permit.selection.repository}`,
    `검토한 라이선스: ${permit.selection.license}`,
    `검토한 npm scope owner: ${scopeKind} ${permit.selection.scopeOwner.name}`,
    "상태: 검토한 원본과 후보가 그대로일 때만 package.json 교체를 허가합니다.",
    "",
    "이 허가는 원본이 달라지면 사용할 수 없습니다.",
    "release manifest는 직접 수정하지 않고 package.json 적용 뒤 다시 만들어야 합니다.",
    "이 명령은 파일 수정, release manifest 재생성, 게시 활성화나 패키지 게시를 실행하지 않았습니다.",
  ];
  return `${lines.join("\n")}\n`;
}
