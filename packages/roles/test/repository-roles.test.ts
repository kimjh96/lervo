import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { listRoleContracts, resolveRoleContract } from "../src/index.js";

const roots: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-role-contract-"));
  roots.push(root);
  await mkdir(resolve(root, ".lervo/roles"), { recursive: true });
  return root;
}

async function source(root: string, value: Record<string, unknown>): Promise<void> {
  await writeFile(
    resolve(root, ".lervo/roles", `${String(value.roleId)}.json`),
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("repository role contracts", () => {
  it("keeps six built-in templates including researcher versioned and hash-bound", async () => {
    const root = await repository();
    const contracts = await listRoleContracts(root);
    expect(contracts.map((contract) => contract.roleId)).toEqual([
      "designer",
      "developer",
      "ideation",
      "marketer",
      "researcher",
      "writer",
    ]);
    expect(contracts.find((contract) => contract.roleId === "researcher")).toMatchObject({
      version: "1.0.0",
      sourceKind: "built_in",
      contractHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
  });

  it("specializes a built-in role and returns the same deterministic contract hash", async () => {
    const root = await repository();
    await source(root, {
      schemaVersion: 1,
      kind: "lervo_repository_role",
      roleId: "legal-researcher",
      version: "1.2.0",
      extends: [{ roleId: "researcher", version: "1.0.0" }],
      profile: {
        name: "Legal Researcher",
        description: "Specializes the verified researcher contract for legal source analysis.",
        requestTypes: ["legal.research"],
        handoff: {
          allowedRoleIds: ["writer"],
          evidenceLinksRequired: true,
          sharedContextRequired: true,
        },
      },
      checks: [],
    });
    const first = await resolveRoleContract(root, "legal-researcher");
    const second = await resolveRoleContract(root, "legal-researcher");
    expect(first).toMatchObject({
      roleId: "legal-researcher",
      version: "1.2.0",
      sourceKind: "repository",
      contractHash: second.contractHash,
    });
    expect(first.definition.profile.requestTypes).toContain("research");
    expect(first.definition.profile.requestTypes).toContain("legal.research");
    expect(first.definition.profile.handoff.allowedRoleIds).toContain("writer");
    expect(first.extends).toEqual([
      expect.objectContaining({
        roleId: "researcher",
        version: "1.0.0",
        contractHash: expect.stringMatching(/^sha256:/u),
      }),
    ]);
  });

  it("composes built-in roles with restrictive capabilities and explicit output semantics", async () => {
    const root = await repository();
    await source(root, {
      schemaVersion: 1,
      kind: "lervo_repository_role",
      roleId: "growth-researcher",
      version: "2.0.0",
      extends: [
        { roleId: "researcher", version: "1.0.0" },
        { roleId: "marketer", version: "1.0.0" },
      ],
      profile: {
        name: "Growth Researcher",
        description: "Combines evidence research with bounded marketing analysis.",
        outputContract: {
          artifactKind: "growth_research_brief",
          schemaRef: "lervo-schema://roles/growth-research-brief/v1",
          pathTemplate: ".lervo/generated/growth-research/{runId}.md",
          citationsRequired: true,
          presentation: { audience: "human", locale: "en", writingPolicyId: "writing_en-human" },
        },
      },
      checks: [],
    });
    const contract = await resolveRoleContract(root, "growth-researcher");
    expect(contract.definition.profile.capabilities["network.access"]).toBe("deny");
    expect(contract.definition.profile.capabilities["external.message"]).toBe("deny");
    expect(contract.definition.profile.verification.suiteIds).toEqual([
      "role.marketing.artifact",
      "role.research.artifact",
    ]);
  });

  it("rejects stale ancestry and custom replacement of a built-in role", async () => {
    const root = await repository();
    await source(root, {
      schemaVersion: 1,
      kind: "lervo_repository_role",
      roleId: "stale-researcher",
      version: "1.0.0",
      extends: [{ roleId: "researcher", version: "9.0.0" }],
      profile: {},
      checks: [],
    });
    await expect(resolveRoleContract(root, "stale-researcher")).rejects.toMatchObject({
      code: "role_contract_stale",
    });

    const duplicateRoot = await repository();
    await source(duplicateRoot, {
      schemaVersion: 1,
      kind: "lervo_repository_role",
      roleId: "researcher",
      version: "2.0.0",
      extends: [],
      profile: {},
      checks: [],
    });
    await expect(listRoleContracts(duplicateRoot)).rejects.toMatchObject({
      code: "role_profile_invalid",
    });
  });
});
