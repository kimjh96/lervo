import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { parse } from "yaml";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyInitPlan,
  createInitPlan,
  defaultRepositoryDocumentPolicy,
  isConditionalDefaultDocumentRole,
  seedRepositoryDocumentRoles,
  validateDecisionTaxonomy,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function roleIds(roles: ReadonlyArray<{ roleId: string }>): string[] {
  return roles.map((role) => role.roleId);
}

describe("repository document role seeding", () => {
  const roles = defaultRepositoryDocumentPolicy.roles;

  it("drops Lervo product-document templates whose paths and aliases are absent", () => {
    expect(roleIds(seedRepositoryDocumentRoles(roles, () => false))).toEqual([
      "public_overview",
      "continuation_source",
    ]);
    expect(
      roleIds(seedRepositoryDocumentRoles(roles, (path) => path === "ARCHITECTURE.md")),
    ).toEqual(["public_overview", "system_architecture", "continuation_source"]);
  });

  it("keeps a repository-edited role and re-adds a template only for a placed document", () => {
    const edited = roles.map((role) =>
      role.roleId === "delivery_roadmap" ? { ...role, path: "docs/roadmap/v0.md" } : role,
    );
    expect(
      isConditionalDefaultDocumentRole(edited.find((role) => role.roleId === "delivery_roadmap")!),
    ).toBe(false);
    expect(roleIds(seedRepositoryDocumentRoles(edited, () => false))).toContain("delivery_roadmap");

    const seeded = seedRepositoryDocumentRoles(roles, () => false);
    expect(roleIds(seedRepositoryDocumentRoles(seeded, () => true))).toEqual(roleIds(seeded));
    expect(
      roleIds(
        seedRepositoryDocumentRoles(seeded, () => false, new Set(["docs/product/vision.md"])),
      ),
    ).toEqual(["public_overview", "continuation_source", "product_vision"]);
  });

  it("initializes another repository without Lervo's absent document paths", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-role-seeding-"));
    roots.push(root);
    await mkdir(resolve(root, "docs/architecture"), { recursive: true });
    await writeFile(resolve(root, "docs/architecture/system.md"), "# System\n");
    await applyInitPlan(await createInitPlan({ root, projectId: "prj_roleseeding" }));
    const taxonomy = validateDecisionTaxonomy(
      parse(await readFile(resolve(root, ".lervo/knowledge/document-layout.yaml"), "utf8")),
    );
    expect(roleIds(taxonomy.documentPolicy.roles)).toEqual([
      "public_overview",
      "system_architecture",
      "continuation_source",
    ]);
  });
});
