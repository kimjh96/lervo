export function formatFirstPublicationPackageMetadataApplyReceipt(receipt) {
  return [
    "CLI 최초 게시 package metadata 적용 완료",
    "- package.json을 검토한 후보로 교체했습니다.",
    "- release manifest를 다시 만들었습니다.",
    "- release SBOM을 다시 만들었습니다.",
    "- transaction 임시 기록을 제거했습니다.",
    "- 승인, 게시 활성화와 패키지 게시는 실행하지 않았습니다.",
    `결과 상태: ${receipt.status}`,
    "",
  ].join("\n");
}

export function formatFirstPublicationPackageMetadataRecovery(result) {
  const message = result.status === "rolled_back"
    ? "중단된 적용을 원본 세 파일로 되돌렸습니다."
    : "적용은 이미 끝났으며 남은 transaction 임시 기록을 제거했습니다.";
  return `CLI 최초 게시 package metadata 복구 완료\n- ${message}\n`;
}
