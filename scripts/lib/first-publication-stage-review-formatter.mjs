export function formatFirstPublicationStageReviewEvidence(report) {
  return [
    "CLI npm staged package 검토 증거: 확인됨",
    `- 대상: ${report.target.package}@${report.target.version}`,
    "- stage: 같은 package·version의 항목이 하나이며 list와 view가 일치함",
    "- tarball: 내려받은 파일이 이전 stage 결과의 digest와 일치함",
    "- 안정성: 검토 뒤 stage metadata와 npm 사용자 설정을 다시 확인함",
    "- 개인정보: stage ID와 npm 계정 정보는 보고서에 저장하지 않음",
    "- 주의: 사람의 승인, 2FA 완료 또는 공개 배포를 뜻하지 않음",
    "- 변경 사항: stage list·view·download만 수행; approve·reject는 수행하지 않음",
    "",
  ].join("\n");
}
