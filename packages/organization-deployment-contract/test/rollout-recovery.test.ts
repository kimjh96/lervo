import { classifyOrganizationNodeRolloutRecovery } from "../src/index.js";
import { describe, expect, it } from "vitest";

const privacy = {
  absolutePaths: "excluded" as const,
  credentials: "excluded" as const,
  serviceDefinitionBodies: "excluded" as const,
};

const baseline = {
  localPlanId: `nfp_${"1".repeat(24)}`,
  localPlanHash: `sha256:${"2".repeat(64)}`,
  registry: "register" as const,
  serviceTarget: "absent" as const,
  legacyTarget: "absent" as const,
  privacy,
};

describe("organization Node rollout recovery", () => {
  it("classifies only exact unchanged or exact desired projections", () => {
    expect(classifyOrganizationNodeRolloutRecovery({ baseline, current: baseline })).toBe(
      "not_applied",
    );
    expect(
      classifyOrganizationNodeRolloutRecovery({
        baseline,
        current: {
          ...baseline,
          localPlanId: `nfp_${"3".repeat(24)}`,
          localPlanHash: `sha256:${"4".repeat(64)}`,
          registry: "unchanged",
          serviceTarget: "desired",
        },
      }),
    ).toBe("applied");
    expect(
      classifyOrganizationNodeRolloutRecovery({
        baseline: { ...baseline, serviceTarget: "desired" },
        current: { ...baseline, serviceTarget: "desired" },
      }),
    ).toBe("unknown");
    expect(
      classifyOrganizationNodeRolloutRecovery({
        baseline,
        current: {
          ...baseline,
          localPlanId: `nfp_${"5".repeat(24)}`,
          localPlanHash: `sha256:${"6".repeat(64)}`,
          serviceTarget: "conflict",
        },
      }),
    ).toBe("unknown");
  });
});
