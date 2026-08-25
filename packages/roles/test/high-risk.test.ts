import { describe, expect, it } from "vitest";

import {
  assertHighRiskRoleWorkflow,
  createHighRiskRoleWorkflow,
  getBuiltInRoleDefinition,
} from "../src/index.js";

const publication = {
  surface: "documentation" as const,
  writingPolicyId: "writing_en-human",
  writingPolicyHash: `sha256:${"c".repeat(64)}`,
  requiresWritingPermit: true as const,
};

describe("high-risk cross-role workflow", () => {
  it("binds distinct roles and remains valid when Codex and Claude assignments swap", () => {
    const definitions = {
      primary: getBuiltInRoleDefinition("marketer"),
      reviewer: getBuiltInRoleDefinition("researcher"),
      verifier: getBuiltInRoleDefinition("designer"),
    };
    const workflow = createHighRiskRoleWorkflow({
      projectId: "prj_role_workflow_01",
      primary: {
        definition: definitions.primary,
        providerSelection: { mode: "fixed", provider: "codex" },
      },
      reviewer: {
        definition: definitions.reviewer,
        providerSelection: { mode: "fixed", provider: "claude" },
      },
      verifier: {
        definition: definitions.verifier,
        providerSelection: { mode: "allowlist", providers: ["codex", "claude"] },
      },
      publication,
    });

    expect(workflow.primaryRoleId).toBe("marketer");
    expect(workflow.deliberationPolicy.decisionOwnerRoleId).toBe("marketer");
    expect(workflow.deliberationPolicy.requiredVerificationSuiteIds).toEqual([
      "role.design.artifact",
      "role.marketing.artifact",
      "role.research.artifact",
    ]);
    expect(workflow.roleBindings.map((binding) => binding.responsibilities)).toEqual([
      ["proposer", "decision_owner"],
      ["reviewer"],
      ["verifier"],
    ]);
    expect(() =>
      assertHighRiskRoleWorkflow({
        workflow,
        definitions: Object.values(definitions),
      }),
    ).not.toThrow();

    const swapped = createHighRiskRoleWorkflow({
      projectId: "prj_role_workflow_01",
      primary: {
        definition: definitions.primary,
        providerSelection: { mode: "fixed", provider: "claude" },
      },
      reviewer: {
        definition: definitions.reviewer,
        providerSelection: { mode: "fixed", provider: "codex" },
      },
      verifier: {
        definition: definitions.verifier,
        providerSelection: { mode: "allowlist", providers: ["codex", "claude"] },
      },
      publication,
    });
    expect(swapped.workflowId).not.toBe(workflow.workflowId);
    expect(() =>
      assertHighRiskRoleWorkflow({
        workflow: swapped,
        definitions: Object.values(definitions),
      }),
    ).not.toThrow();
  });

  it("rejects same-role review, excessive rounds and tampered evaluation binding", () => {
    const marketer = getBuiltInRoleDefinition("marketer");
    const researcher = getBuiltInRoleDefinition("researcher");
    const designer = getBuiltInRoleDefinition("designer");
    const common = { projectId: "prj_role_workflow_01", publication };
    expect(() =>
      createHighRiskRoleWorkflow({
        ...common,
        primary: { definition: marketer, providerSelection: { mode: "fixed", provider: "codex" } },
        reviewer: {
          definition: marketer,
          providerSelection: { mode: "fixed", provider: "claude" },
        },
        verifier: { definition: designer, providerSelection: { mode: "fixed", provider: "codex" } },
      }),
    ).toThrow(/different|schema/);
    expect(() =>
      createHighRiskRoleWorkflow({
        ...common,
        primary: { definition: marketer, providerSelection: { mode: "fixed", provider: "codex" } },
        reviewer: {
          definition: researcher,
          providerSelection: { mode: "fixed", provider: "claude" },
        },
        verifier: { definition: designer, providerSelection: { mode: "fixed", provider: "codex" } },
        maxRounds: 6,
      }),
    ).toThrow(/round count/);

    const workflow = createHighRiskRoleWorkflow({
      ...common,
      primary: { definition: marketer, providerSelection: { mode: "fixed", provider: "codex" } },
      reviewer: {
        definition: researcher,
        providerSelection: { mode: "fixed", provider: "claude" },
      },
      verifier: { definition: designer, providerSelection: { mode: "fixed", provider: "codex" } },
    });
    workflow.roleBindings[0]!.evaluationBundleHash = `sha256:${"d".repeat(64)}`;
    expect(() =>
      assertHighRiskRoleWorkflow({
        workflow,
        definitions: [marketer, researcher, designer],
      }),
    ).toThrow(/ID|binding/);
  });
});
