import { createDoctorRecoveryGuidance } from "./recovery-guidance.js";
import { doctorCheckIdsForScope } from "./doctor-scope-contract.js";
import type { DoctorCheck, DoctorReport } from "./types.js";

function expectedStatus(checks: readonly DoctorCheck[]): DoctorReport["status"] {
  if (checks.some((check) => check.status === "unhealthy")) return "unhealthy";
  if (checks.some((check) => check.status === "unknown")) return "unknown";
  return "healthy";
}

export function isDoctorReportSemanticallyValid(report: DoctorReport): boolean {
  const expectedCheckIds = doctorCheckIdsForScope(report.scope);
  const actualCheckIds = report.checks.map((check) => check.checkId);
  if (
    actualCheckIds.length !== expectedCheckIds.length ||
    new Set(actualCheckIds).size !== actualCheckIds.length ||
    expectedCheckIds.some((checkId) => !actualCheckIds.includes(checkId))
  ) {
    return false;
  }
  if (report.status !== expectedStatus(report.checks)) return false;

  const expectedGuidance = createDoctorRecoveryGuidance(report.issues);
  return (
    report.recoveryGuidance.length === expectedGuidance.length &&
    report.recoveryGuidance.every((guidance, index) => {
      const expected = expectedGuidance[index];
      return (
        expected !== undefined &&
        guidance.issueCode === expected.issueCode &&
        guidance.actionCode === expected.actionCode &&
        guidance.message === expected.message &&
        guidance.actionState === expected.actionState
      );
    })
  );
}
