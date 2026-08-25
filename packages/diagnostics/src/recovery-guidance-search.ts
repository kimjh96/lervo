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
      "Check the search engine selection history and candidate replay evidence, then rerun search-scope diagnostics.",
  },
  search_rollout_policy_invalid: {
    actionCode: "inspect_search_policy",
    message:
      "Check the format and relationships of the search engine, rollout review, and action policies.",
  },
  search_rollout_review_invalid: {
    actionCode: "inspect_search_review",
    message: "Check the relation between the search rollout review and its quality evidence.",
  },
  search_rollout_review_unavailable: {
    actionCode: "resolve_search_review_prerequisites",
    message:
      "Resolve the search engine selection and policy issues first, then diagnose the rollout review again.",
  },
  search_rollout_action_invalid: {
    actionCode: "inspect_search_action",
    message:
      "Check the relation between the search rollout action and its policy, review, and quality evidence.",
  },
  search_rollout_action_unavailable: {
    actionCode: "resolve_search_action_prerequisites",
    message:
      "Resolve the search selection, policy, and review issues first, then diagnose the rollout action again.",
  },
} satisfies GuidanceMap;
