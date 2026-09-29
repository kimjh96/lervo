import { describe, expect, it } from "vitest";

import { createChangedRuntimeVerificationPlan } from "../changed-verification/verification-plan.mjs";

describe("changed runtime verification plan", () => {
  it("keeps analyzable source and directly changed tests on the related-test path", () => {
    expect(
      createChangedRuntimeVerificationPlan([
        "packages/core/src/index.ts",
        "scripts/evaluation/test/example.test.mjs",
      ]),
    ).toMatchObject({
      mode: "related",
      arguments: [
        "run",
        "--changed",
        "HEAD",
        "--passWithNoTests",
        "--pool=threads",
        "--maxWorkers=1",
        "--reporter=dot",
      ],
      changedPathCount: 2,
      escalationTriggers: [],
    });
  });

  it.each([
    ["vitest.config.ts", "workspace_or_test_configuration"],
    ["vitest.workspace.mts", "workspace_or_test_configuration"],
    ["tsconfig.build.json", "workspace_or_test_configuration"],
    ["packages/core/package.json", "workspace_or_test_configuration"],
    ["scripts/quality/check-docs.mjs", "repository_execution_script"],
    [".github/workflows/check.yml", "workflow_runtime_definition"],
    ["packages/schemas/test/fixtures/valid.json", "runtime_loaded_asset_or_fixture"],
    ["apps/hub/public/index.html", "runtime_loaded_non_source_file"],
    ["apps/hub/assets/client.js", "runtime_loaded_asset_or_fixture"],
  ])("escalates %s because its runtime relationship is opaque", (path, reason) => {
    const plan = createChangedRuntimeVerificationPlan([path]);
    expect(plan).toMatchObject({
      mode: "full",
      arguments: ["run", "--pool=threads", "--maxWorkers=1", "--reporter=dot"],
      escalationTriggers: [{ path, reason }],
    });
    expect(plan.arguments).not.toContain("--changed");
  });

  it("deduplicates paths while retaining every distinct escalation trigger", () => {
    expect(
      createChangedRuntimeVerificationPlan([
        "scripts/quality/check-docs.mjs",
        "package.json",
        "scripts/quality/check-docs.mjs",
      ]),
    ).toMatchObject({
      changedPathCount: 2,
      escalationTriggers: [
        { path: "package.json", reason: "workspace_or_test_configuration" },
        { path: "scripts/quality/check-docs.mjs", reason: "repository_execution_script" },
      ],
    });
  });

  it.each(["/absolute.ts", "../outside.ts", "nested\\windows.ts", ""])(
    "rejects a non-repository path: %s",
    (path) => {
      expect(() => createChangedRuntimeVerificationPlan([path])).toThrow(
        "Changed paths must be normalized repository-relative paths.",
      );
    },
  );
});
