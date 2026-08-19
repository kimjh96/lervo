import type {
  DoctorCheck,
  DoctorInspection,
  DoctorIssue,
  DoctorIssueCode,
} from "@lervo/diagnostics";

export function doctorIssue(code: DoctorIssueCode, message: string): DoctorIssue {
  return { code, eventId: null, message };
}

export function doctorInspection(
  checkId: DoctorCheck["checkId"],
  status: DoctorCheck["status"],
  observedCount: number,
  issues: DoctorIssue[] = [],
  version?: string,
): DoctorInspection {
  return {
    check: {
      checkId,
      status,
      observedCount,
      ...(version === undefined ? {} : { version }),
    },
    issues,
  };
}
