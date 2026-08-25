import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyPublicReadmeImprovementPlan,
  createPublicReadmeImprovementPlan,
  extractPublicReadmeCoordinates,
} from "../src/index.js";

const roots: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-public-readme-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_public_readme_001",
      now: new Date("2026-08-25T00:00:00.000Z"),
    }),
  );
  return root;
}

afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
);

describe("public README improvement", () => {
  it("makes every protected coordinate change visible and requires exact individual approval", async () => {
    const root = await repository();
    const source = `<div align="center">\n<img src="logo.png" alt="Flemo logo">\n</div>\n\n# Flemo\n\n[![npm badge](https://img.shields.io/npm/v/@flemo/core)](https://npmjs.com/package/@flemo/core)\n\n\`\`\`bash\nnpm install @flemo/core\n\`\`\`\n\n[License](LICENSE)\n`;
    await writeFile(resolve(root, "README.md"), source);
    const candidate = source
      .replace("# Flemo", "# Flemo toolkit")
      .replace("[License](LICENSE)", "[License](docs/LICENSE.md)");
    const plan = await createPublicReadmeImprovementPlan({
      repositoryRoot: root,
      candidateContent: candidate,
      audience: "Package users and contributors",
      intent: "Clarify positioning and update the reviewed license route.",
    });
    expect(plan.status).toBe("review_required");
    expect(plan.coordinateChanges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "license_link",
          disposition: "removed",
          value: expect.stringContaining("LICENSE"),
        }),
        expect.objectContaining({
          kind: "license_link",
          disposition: "added",
          value: expect.stringContaining("docs/LICENSE.md"),
        }),
      ]),
    );
    await expect(
      applyPublicReadmeImprovementPlan({
        plan,
        candidateContent: candidate,
        approvedOperationId: plan.operationId,
        approvedHash: plan.approvalHash,
        approvedCoordinateChangeIds: [],
        now: new Date(),
        recordApplied: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "knowledge_approval_required" });
    await applyPublicReadmeImprovementPlan({
      plan,
      candidateContent: candidate,
      approvedOperationId: plan.operationId,
      approvedHash: plan.approvalHash,
      approvedCoordinateChangeIds: plan.coordinateChanges.map((item) => item.changeId),
      now: new Date("2026-08-25T01:00:00.000Z"),
      recordApplied: () => undefined,
    });
    expect(await readFile(resolve(root, "README.md"), "utf8")).toBe(candidate);
  });

  it("extracts presentation, package, command, link, and accessibility coordinates deterministically", () => {
    const content = `# Package\n\n![Accessible logo](logo.svg)\n\n[Security](SECURITY.md)\n\n\`\`\`sh\npnpm add @scope/pkg\n\`\`\`\n`;
    const first = extractPublicReadmeCoordinates(content);
    expect(first.map((item) => item.kind)).toEqual(
      expect.arrayContaining([
        "accessibility_text",
        "fenced_command",
        "image",
        "package_name",
        "security_link",
      ]),
    );
    expect(extractPublicReadmeCoordinates(content)).toEqual(first);
  });

  it("reads an internal root README symlink without replacing the user-owned link", async () => {
    const root = await repository();
    await mkdir(resolve(root, "packages", "react"), { recursive: true });
    const content =
      '<div align="center">\n<h1>Flemo</h1>\n</div>\n\n```sh\nnpm install @flemo/react\n```\n';
    await writeFile(resolve(root, "packages", "react", "README.md"), content);
    await symlink("packages/react/README.md", resolve(root, "README.md"));

    const plan = await createPublicReadmeImprovementPlan({
      repositoryRoot: root,
      candidateContent: content,
      audience: "Package users",
      intent: "Preserve the public entrypoint.",
    });

    expect(plan.status).toBe("current");
    expect(plan.operations).toEqual([]);
    expect((await lstat(resolve(root, "README.md"))).isSymbolicLink()).toBe(true);
  });

  it("rejects internal bookkeeping and invented coordinates for a missing public README", async () => {
    const root = await repository();
    await expect(
      createPublicReadmeImprovementPlan({
        repositoryRoot: root,
        candidateContent: "# Product\n\nRead AGENTS.md and run lervo terminal status.\n",
        audience: "Users",
        intent: "Create onboarding.",
      }),
    ).rejects.toMatchObject({ code: "knowledge_compile_policy_violation" });
    await expect(
      createPublicReadmeImprovementPlan({
        repositoryRoot: root,
        candidateContent: "# Product\n\nRun `npm install invented-package`.\n",
        audience: "Users",
        intent: "Create onboarding.",
      }),
    ).rejects.toMatchObject({ code: "knowledge_compile_policy_violation" });
  });
});
