import { formatFirstPublicationMetadataChange } from
  "./first-publication-metadata-change-formatter.mjs";

export function formatFirstPublicationPackageMetadataCandidate(candidate) {
  const lines = [
    "CLI 최초 게시 package.json 후보",
    `대상: ${candidate.target.package}@${candidate.target.version}`,
    "상태: 내용을 검토해야 하며 아직 적용할 수 없습니다.",
    "",
    "후보에 반영된 변경:",
  ];
  for (const change of candidate.changes) {
    lines.push(`- ${formatFirstPublicationMetadataChange(change)}`);
  }
  lines.push(
    "",
    "정확한 package.json 내용은 같은 인자에 --package-json을 붙여 확인할 수 있습니다.",
    "이 명령은 파일 수정, release manifest 재생성, 승인 생성, 게시 활성화나 패키지 게시를 실행하지 않았습니다.",
  );
  return `${lines.join("\n")}\n`;
}
