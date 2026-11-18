import type { DoctorIssueCode, DoctorRecoveryActionCode } from "./types.js";

type GuidanceMap = Partial<
  Record<
    DoctorIssueCode,
    {
      actionCode: DoctorRecoveryActionCode;
      message: string;
    }
  >
>;

export const eventChainRecoveryGuidance = {
  event_chain_invalid: {
    actionCode: "inspect_event_history",
    message:
      "Check local execution records and recoverable backups; do not overwrite the source directly.",
  },
} satisfies GuidanceMap;
