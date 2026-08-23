export function formatFirstPublicationPackageMetadataApplyReceipt(receipt) {
  return [
    "CLI first-publication package metadata apply complete",
    "- Replaced package.json with the reviewed candidate.",
    "- Rebuilt the release manifest.",
    "- Rebuilt the release SBOM.",
    "- Removed the temporary transaction record.",
    "- No approval, publishing activation, or package publication was performed.",
    `Result status: ${receipt.status}`,
    "",
  ].join("\n");
}

export function formatFirstPublicationPackageMetadataRecovery(result) {
  const message = result.status === "rolled_back"
    ? "Restored the three original files after an interrupted apply."
    : "The apply had already completed; removed the remaining temporary transaction record.";
  return `CLI first-publication package metadata recovery complete\n- ${message}\n`;
}
