export function formatFirstPublicationExternalEvidenceReport(report) {
  return [
    "CLI 최초 게시 외부 요구사항 증거 결속 완료",
    `대상: ${report.target.package}@${report.target.version}`,
    "- 현재 package metadata 사후 검증 결과를 다시 확인했습니다.",
    "- 별도 라이선스 승인 문서를 결속했습니다.",
    "- public npm에서 현재 패키지가 보이지 않는 것을 확인했습니다.",
    "- 별도 npm scope control 확인 문서를 결속했습니다.",
    "- 전체 최초 게시 승인 문서를 결속했습니다.",
    "",
    "이 결과는 게시 실행 허가가 아닙니다.",
    "사람의 신원과 npm scope 권한은 외부 시스템에서 검증하지 않았습니다.",
    "npm 조회는 공개 package 결과이며 비공개 package의 부재를 확인하지 않았습니다.",
    "파일 수정, 승인 생성, 게시 활성화와 패키지 게시는 실행하지 않았습니다.",
    "",
  ].join("\n");
}
