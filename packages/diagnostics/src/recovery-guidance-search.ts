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

export const searchRecoveryGuidance = {
  search_engine_selection_invalid: {
    actionCode: "inspect_search_selection",
    message:
      "Check that the product-default search engine is registered with its qualified build, then rerun search-scope diagnostics.",
  },
} satisfies GuidanceMap;
