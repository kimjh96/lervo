import {
  createDoctorRecoveryGuidance,
  type DoctorIssue,
} from "@lervo/diagnostics";
import { describe, expect, it } from "vitest";

describe("doctor recovery guidance", () => {
  it("derives bounded guidance from issue codes and removes duplicate codes", () => {
    const issues: DoctorIssue[] = [
      {
        code: "search_rollout_action_invalid",
        eventId: "evt_private_action_01",
        message: "내부 오류 /Users/private/project와 secret-token",
      },
      {
        code: "search_rollout_action_invalid",
        eventId: "evt_private_action_02",
        message: "다른 내부 오류",
      },
      {
        code: "search_rollout_action_unavailable",
        eventId: null,
        message: "선행 검사 실패",
      },
      {
        code: "provider_executable_missing",
        eventId: null,
        message: "provider 경로 없음",
      },
    ];

    const guidance = createDoctorRecoveryGuidance(issues);

    expect(guidance).toEqual([
      {
        issueCode: "search_rollout_action_invalid",
        actionCode: "inspect_search_action",
        message: "검색 rollout 조치와 정책·검토·품질 근거의 연결을 확인하세요.",
        actionState: "not_performed",
      },
      {
        issueCode: "search_rollout_action_unavailable",
        actionCode: "resolve_search_action_prerequisites",
        message: "검색 선택·정책·검토 문제를 먼저 해결한 뒤 rollout 조치를 다시 진단하세요.",
        actionState: "not_performed",
      },
      {
        issueCode: "provider_executable_missing",
        actionCode: "check_provider_executable",
        message: "문제가 난 에이전트 실행 파일의 설치 상태와 실행 경로 설정을 확인하세요.",
        actionState: "not_performed",
      },
    ]);
    expect(JSON.stringify(guidance)).not.toContain("evt_private");
    expect(JSON.stringify(guidance)).not.toContain("/Users/private");
    expect(JSON.stringify(guidance)).not.toContain("secret-token");
  });

  it("returns no guidance when there are no issues", () => {
    expect(createDoctorRecoveryGuidance([])).toEqual([]);
  });
});
