import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import type { DeliberationWorkflowSource } from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import {
  loadDeliberationWorkflowSource,
  validateDeliberationWorkflowSource,
} from "../src/deliberation-policy-loader.js";

const roots: string[] = [];

function validSource(): DeliberationWorkflowSource {
  return {
    schemaVersion: 1 as const,
    policyId: "deliberation_product-review",
    maxRounds: 2,
    requiredVerificationSuiteIds: ["project.default"],
    participants: [{
      roleId: "product-planner",
      name: "제품 기획자",
      description: "사용자 가치와 범위를 정합니다.",
      provider: "codex",
      responsibilities: ["proposer", "decision_owner"],
    }, {
      roleId: "maintainability-reviewer",
      name: "유지보수 검토자",
      description: "변경 비용을 검토합니다.",
      provider: "claude",
      responsibilities: ["reviewer"],
    }, {
      roleId: "project-verifier",
      name: "프로젝트 검증자",
      description: "실제 검증 결과를 확인합니다.",
      provider: "claude",
      responsibilities: ["verifier"],
    }],
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("deliberation workflow source", () => {
  it("requires a separate proposer, reviewers, verifier, and both providers", () => {
    expect(() => validateDeliberationWorkflowSource(validSource())).not.toThrow();
    const combined = structuredClone(validSource());
    combined.participants[1]!.responsibilities = ["reviewer", "verifier"];
    combined.participants[2]!.responsibilities = ["reviewer"];
    expect(() => validateDeliberationWorkflowSource(combined)).toThrow(
      "별도 검증 역할",
    );
    const oneProvider = structuredClone(validSource());
    for (const participant of oneProvider.participants) participant.provider = "codex";
    expect(() => validateDeliberationWorkflowSource(oneProvider)).toThrow(
      "별도 검증 역할",
    );
  });

  it("loads one bounded policy file whose name matches its ID", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-deliberation-policy-"));
    roots.push(root);
    await applyInitPlan(await createInitPlan({ root, projectId: "prj_policy_loader1" }));
    const path = resolve(
      root,
      ".lervo/deliberations/deliberation_product-review.yaml",
    );
    await writeFile(path, [
      "schemaVersion: 1",
      "policyId: deliberation_product-review",
      "maxRounds: 2",
      "requiredVerificationSuiteIds: [project.default]",
      "participants:",
      "  - roleId: product-planner",
      "    name: 제품 기획자",
      "    description: 사용자 가치와 범위를 정합니다.",
      "    provider: codex",
      "    responsibilities: [proposer, decision_owner]",
      "  - roleId: maintainability-reviewer",
      "    name: 유지보수 검토자",
      "    description: 변경 비용을 검토합니다.",
      "    provider: claude",
      "    responsibilities: [reviewer]",
      "  - roleId: project-verifier",
      "    name: 프로젝트 검증자",
      "    description: 실제 검증 결과를 확인합니다.",
      "    provider: claude",
      "    responsibilities: [verifier]",
      "",
    ].join("\n"));

    await expect(loadDeliberationWorkflowSource(
      root,
      "deliberation_product-review",
    )).resolves.toMatchObject({ policyId: "deliberation_product-review" });
    await expect(loadDeliberationWorkflowSource(
      root,
      "deliberation_other-review",
    )).rejects.toMatchObject({ code: "deliberation_policy_not_found" });
  });

  it("does not follow a symbolic-link policy file", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-deliberation-policy-"));
    const outside = await mkdtemp(resolve(tmpdir(), "lervo-deliberation-policy-outside-"));
    roots.push(root, outside);
    await applyInitPlan(await createInitPlan({ root, projectId: "prj_policy_loader2" }));
    const source = resolve(outside, "policy.yaml");
    await writeFile(source, "outside: true\n");
    await symlink(
      source,
      resolve(root, ".lervo/deliberations/deliberation_product-review.yaml"),
    );

    await expect(loadDeliberationWorkflowSource(
      root,
      "deliberation_product-review",
    )).rejects.toMatchObject({ code: "deliberation_policy_layout_invalid" });
  });
});
