import { environmentRecoveryGuidance } from "./recovery-guidance-environment.js";
import { knowledgeRecoveryGuidance } from "./recovery-guidance-knowledge.js";
import { searchRecoveryGuidance } from "./recovery-guidance-search.js";
import type {
  DoctorIssue,
  DoctorIssueCode,
  DoctorRecoveryActionCode,
  DoctorRecoveryGuidance,
} from "./types.js";

interface GuidanceTemplate {
  actionCode: DoctorRecoveryActionCode;
  message: string;
}

const guidanceByIssueCode = {
  ...knowledgeRecoveryGuidance,
  ...environmentRecoveryGuidance,
  ...searchRecoveryGuidance,
} satisfies Record<DoctorIssueCode, GuidanceTemplate>;

export function createDoctorRecoveryGuidance(
  issues: readonly DoctorIssue[],
): DoctorRecoveryGuidance[] {
  const seen = new Set<DoctorIssueCode>();
  const guidance: DoctorRecoveryGuidance[] = [];
  for (const issue of issues) {
    if (seen.has(issue.code)) continue;
    seen.add(issue.code);
    guidance.push({
      issueCode: issue.code,
      ...guidanceByIssueCode[issue.code],
      actionState: "not_performed",
    });
  }
  return guidance;
}
