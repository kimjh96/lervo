import { createDoctorRecoveryGuidance, type DoctorIssue } from "@lervo/diagnostics";
import { describe, expect, it } from "vitest";

describe("doctor recovery guidance", () => {
  it("derives bounded guidance from issue codes and removes duplicate codes", () => {
    const issues: DoctorIssue[] = [
      {
        code: "search_rollout_action_invalid",
        eventId: "evt_private_action_01",
        message: "internal error /Users/private/project and secret-token",
      },
      {
        code: "search_rollout_action_invalid",
        eventId: "evt_private_action_02",
        message: "another internal error",
      },
      {
        code: "search_rollout_action_unavailable",
        eventId: null,
        message: "prerequisite check failed",
      },
      {
        code: "provider_executable_missing",
        eventId: null,
        message: "provider path missing",
      },
    ];

    const guidance = createDoctorRecoveryGuidance(issues);

    expect(guidance).toEqual([
      {
        issueCode: "search_rollout_action_invalid",
        actionCode: "inspect_search_action",
        message:
          "Check the relation between the search rollout action and its policy, review, and quality evidence.",
        actionState: "not_performed",
      },
      {
        issueCode: "search_rollout_action_unavailable",
        actionCode: "resolve_search_action_prerequisites",
        message:
          "Resolve the search selection, policy, and review issues first, then diagnose the rollout action again.",
        actionState: "not_performed",
      },
      {
        issueCode: "provider_executable_missing",
        actionCode: "check_provider_executable",
        message:
          "Check the installation status and executable-path configuration of the affected agent.",
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
