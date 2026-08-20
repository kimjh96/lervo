import type {
  DoctorIssueCode,
  DoctorRecoveryActionCode,
} from "./types.js";

type GuidanceMap = Partial<Record<DoctorIssueCode, {
  actionCode: DoctorRecoveryActionCode;
  message: string;
}>>;

export const environmentRecoveryGuidance = {
  document_registry_invalid: {
    actionCode: "inspect_document_registry",
    message: "문서 등록 정보의 형식과 문서별 파일 구성을 확인하세요.",
  },
  document_source_invalid: {
    actionCode: "inspect_document_source",
    message: "등록된 문서 원본이 저장소 안의 안전한 일반 파일로 존재하는지 확인하세요.",
  },
  skill_package_invalid: {
    actionCode: "inspect_skill_package",
    message: "스킬 설정, 내용 확인값과 패키지 경로 구성을 확인하세요.",
  },
  skill_lock_missing: {
    actionCode: "refresh_skill_lock",
    message: "현재 스킬 구성을 확인한 뒤 다음 Lervo 관리 실행에서 해석 결과가 기록되는지 확인하세요.",
  },
  skill_lock_invalid: {
    actionCode: "refresh_skill_lock",
    message: "스킬 패키지를 먼저 확인한 뒤 새 Lervo 관리 실행에서 스킬 구성을 다시 해석하세요.",
  },
  skill_lock_stale: {
    actionCode: "refresh_skill_lock",
    message: "변경된 스킬 구성을 검토한 뒤 새 Lervo 관리 실행에서 스킬 구성을 다시 해석하세요.",
  },
  provider_executable_missing: {
    actionCode: "check_provider_executable",
    message: "문제가 난 에이전트 실행 파일의 설치 상태와 실행 경로 설정을 확인하세요.",
  },
  provider_probe_failed: {
    actionCode: "check_provider_executable",
    message: "문제가 난 에이전트 실행 파일이 버전 확인에 정상 응답하는지 확인하세요.",
  },
  provider_platform_unsupported: {
    actionCode: "check_provider_platform",
    message: "현재 운영체제를 해당 에이전트 연결 방식이 지원하는지 확인하세요.",
  },
} satisfies GuidanceMap;
