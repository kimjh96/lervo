import { describe, expect, it } from "vitest";

import {
  assertRoleDefinition,
  getBuiltInRoleDefinition,
  listBuiltInRoleDefinitions,
} from "../src/index.js";

describe("built-in multi-discipline roles", () => {
  it("defines researcher, marketer and designer as distinct executable contracts", () => {
    const definitions = listBuiltInRoleDefinitions();
    expect(definitions.map((definition) => definition.profile.roleId))
      .toEqual(["designer", "marketer", "researcher"]);
    for (const definition of definitions) expect(() => assertRoleDefinition(definition)).not.toThrow();

    const researcher = getBuiltInRoleDefinition("researcher");
    const marketer = getBuiltInRoleDefinition("marketer");
    const designer = getBuiltInRoleDefinition("designer");
    expect(researcher.profile.capabilities["network.access"]).toBe("require_approval");
    expect(marketer.profile.capabilities["external.message"]).toBe("require_approval");
    expect(designer.profile.capabilities["filesystem.write"]).toBe("require_approval");
    expect(researcher.evaluation.checks.map((check) => check.category)).toEqual([
      "artifact_schema", "citation_integrity", "claim_support", "source_traceability",
    ]);
    expect(marketer.evaluation.checks.map((check) => check.category)).toEqual([
      "artifact_schema", "brand_compliance", "claim_support",
    ]);
    expect(designer.evaluation.checks.map((check) => check.category)).toEqual([
      "accessibility", "artifact_schema", "design_token_usage",
    ]);
  });

  it("returns clones so one run cannot mutate the built-in role source", () => {
    const first = getBuiltInRoleDefinition("researcher");
    first.profile.description = "tampered";
    first.evaluation.checks[0]!.requirement = "tampered";

    const second = getBuiltInRoleDefinition("researcher");
    expect(second.profile.description).not.toBe("tampered");
    expect(second.evaluation.checks[0]!.requirement).not.toBe("tampered");
    expect(() => assertRoleDefinition(second)).not.toThrow();
  });
});
