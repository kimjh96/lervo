import type { InstructionPreparationReport } from "@lervo/schemas";

/** Shape validation precedes this check; unknown counts must not be promoted to completeness. */
export function instructionReportConsistent(report: InstructionPreparationReport): boolean {
  const counts = [
    report.observedCount,
    report.applicableCount,
    report.excludedCount,
    report.unresolvedCount,
    report.omittedCount,
  ];
  if (report.status === "unavailable") {
    return (
      counts.every((count) => count === null) &&
      report.catalogDigest === null &&
      report.preparedCount === 0 &&
      report.preparedByteCount === 0 &&
      report.reasonCodes.length === 1 &&
      [
        "instruction_source_unavailable",
        "instruction_source_changed",
        "instruction_catalog_overflow",
        "instruction_scope_invalid",
        "instruction_source_unsafe",
      ].includes(report.reasonCodes[0]!)
    );
  }
  if (
    report.catalogDigest === null ||
    report.observedCount === null ||
    report.applicableCount === null ||
    report.excludedCount === null ||
    report.unresolvedCount === null ||
    report.omittedCount === null
  )
    return false;
  if (
    report.observedCount !==
      report.applicableCount + report.excludedCount + report.unresolvedCount ||
    report.preparedCount + report.omittedCount !==
      report.applicableCount + report.unresolvedCount ||
    (report.preparedCount === 0
      ? report.preparedByteCount !== 0
      : report.preparedByteCount < report.preparedCount)
  )
    return false;
  const expected = [
    ...(report.unresolvedCount > 0 ? ["instruction_scope_unresolved"] : []),
    ...(report.omittedCount > 0 ? ["instruction_capacity_insufficient"] : []),
  ];
  return (
    report.status === (expected.length === 0 ? "complete" : "incomplete") &&
    report.reasonCodes.length === expected.length &&
    expected.every((code) => report.reasonCodes.some((reason) => reason === code))
  );
}
