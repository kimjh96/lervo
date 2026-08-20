import type {
  DoctorIssueCode,
  DoctorRecoveryActionCode,
} from "./types.js";

type GuidanceMap = Partial<Record<DoctorIssueCode, {
  actionCode: DoctorRecoveryActionCode;
  message: string;
}>>;

export const searchRecoveryGuidance = {
  search_engine_selection_invalid: {
    actionCode: "inspect_search_selection",
    message: "검색 엔진 선택 이력과 후보 재현 근거를 확인한 뒤 검색 범위 진단을 다시 실행하세요.",
  },
  search_rollout_policy_invalid: {
    actionCode: "inspect_search_policy",
    message: "검색 엔진·rollout 검토·조치 정책의 형식과 서로의 연결을 확인하세요.",
  },
  search_rollout_review_invalid: {
    actionCode: "inspect_search_review",
    message: "검색 rollout 검토와 당시 품질 근거의 연결을 확인하세요.",
  },
  search_rollout_review_unavailable: {
    actionCode: "resolve_search_review_prerequisites",
    message: "검색 엔진 선택과 정책 문제를 먼저 해결한 뒤 rollout 검토를 다시 진단하세요.",
  },
  search_rollout_action_invalid: {
    actionCode: "inspect_search_action",
    message: "검색 rollout 조치와 정책·검토·품질 근거의 연결을 확인하세요.",
  },
  search_rollout_action_unavailable: {
    actionCode: "resolve_search_action_prerequisites",
    message: "검색 선택·정책·검토 문제를 먼저 해결한 뒤 rollout 조치를 다시 진단하세요.",
  },
} satisfies GuidanceMap;
