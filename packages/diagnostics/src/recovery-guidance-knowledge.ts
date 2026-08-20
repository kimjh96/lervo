import type {
  DoctorIssueCode,
  DoctorRecoveryActionCode,
} from "./types.js";

type GuidanceMap = Partial<Record<DoctorIssueCode, {
  actionCode: DoctorRecoveryActionCode;
  message: string;
}>>;

export const knowledgeRecoveryGuidance = {
  candidate_artifact_invalid: {
    actionCode: "inspect_knowledge_candidate",
    message: "지식 후보 원본과 연결된 근거 파일이 함께 남아 있는지 확인하세요.",
  },
  candidate_decision_missing: {
    actionCode: "inspect_knowledge_candidate",
    message: "지식 후보가 가리키는 숙의 결정 근거가 남아 있는지 확인하세요.",
  },
  candidate_evidence_missing: {
    actionCode: "inspect_knowledge_candidate",
    message: "지식 후보가 가리키는 작업 완료·검증 근거가 남아 있는지 확인하세요.",
  },
  candidate_event_mismatch: {
    actionCode: "inspect_knowledge_candidate",
    message: "지식 후보 원본과 생성 기록의 연결 정보가 같은지 확인하세요.",
  },
  candidate_outcome_not_converged: {
    actionCode: "inspect_knowledge_candidate",
    message: "수렴하지 않은 숙의 결과가 지식 후보로 기록되지 않았는지 확인하세요.",
  },
  candidate_verification_missing: {
    actionCode: "inspect_knowledge_candidate",
    message: "지식 후보가 가리키는 검증 결과와 당시 저장소 상태가 남아 있는지 확인하세요.",
  },
  review_artifact_invalid: {
    actionCode: "inspect_knowledge_review",
    message: "지식 검토 원본과 연결된 근거 파일이 함께 남아 있는지 확인하세요.",
  },
  review_candidate_missing: {
    actionCode: "inspect_knowledge_review",
    message: "지식 검토가 가리키는 후보 원본을 먼저 복구하거나 다시 검토하세요.",
  },
  review_event_mismatch: {
    actionCode: "inspect_knowledge_review",
    message: "지식 검토 원본과 검토 기록의 연결 정보가 같은지 확인하세요.",
  },
  verified_artifact_invalid: {
    actionCode: "inspect_verified_knowledge",
    message: "검증된 지식 원본과 연결된 근거 파일이 함께 남아 있는지 확인하세요.",
  },
  verified_candidate_missing: {
    actionCode: "inspect_verified_knowledge",
    message: "검증된 지식이 가리키는 후보 원본을 먼저 확인하세요.",
  },
  verified_event_mismatch: {
    actionCode: "inspect_verified_knowledge",
    message: "검증된 지식 원본과 승격 기록의 연결 정보가 같은지 확인하세요.",
  },
  verified_review_missing: {
    actionCode: "inspect_verified_knowledge",
    message: "검증된 지식이 가리키는 사람 검토 원본을 먼저 확인하세요.",
  },
  staleness_artifact_invalid: {
    actionCode: "inspect_knowledge_staleness",
    message: "지식 노후화 판정 원본과 연결된 근거 파일이 함께 남아 있는지 확인하세요.",
  },
  staleness_event_mismatch: {
    actionCode: "inspect_knowledge_staleness",
    message: "지식 노후화 판정과 기록의 연결 정보가 같은지 확인하세요.",
  },
  staleness_verified_missing: {
    actionCode: "inspect_knowledge_staleness",
    message: "노후화 판정이 가리키는 검증된 지식 원본을 먼저 확인하세요.",
  },
  event_chain_invalid: {
    actionCode: "inspect_event_history",
    message: "로컬 실행 기록과 복구 가능한 백업을 확인하고 원본을 직접 덮어쓰지 마세요.",
  },
} satisfies GuidanceMap;
