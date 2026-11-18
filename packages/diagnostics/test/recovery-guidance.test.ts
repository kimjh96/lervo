import { createDoctorRecoveryGuidance, type DoctorIssue } from "@lervo/diagnostics";
import { describe, expect, it } from "vitest";

describe("doctor recovery guidance", () => {
  it("derives bounded guidance from issue codes and removes duplicate codes", () => {
    const issues: DoctorIssue[] = [
      {
        code: "search_engine_selection_invalid",
        eventId: "evt_private_selection_01",
        message: "internal error /Users/private/project and secret-token",
      },
      {
        code: "search_engine_selection_invalid",
        eventId: "evt_private_selection_02",
        message: "another internal error",
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
        issueCode: "search_engine_selection_invalid",
        actionCode: "inspect_search_selection",
        message:
          "Check that the product-default search engine is registered with its qualified build, then rerun search-scope diagnostics.",
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
