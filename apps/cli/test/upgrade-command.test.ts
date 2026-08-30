import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function io(root: string, stdout: string[], stderr: string[]) {
  return {
    cwd: root,
    stdout: (message: string) => stdout.push(message),
    stderr: (message: string) => stderr.push(message),
  };
}

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-upgrade-"));
  roots.push(root);
  await writeFile(resolve(root, "main.ts"), "export const value = true;\n");
  expect(await runCli(["init", "--minimal", "--name", "upgrade-fixture"], io(root, [], []))).toBe(
    0,
  );
  return root;
}

describe("lervo upgrade", () => {
  it("plans without changing repository bytes and requires the exact current plan", async () => {
    const root = await repository();
    const output: string[] = [];
    const errors: string[] = [];
    const planCode = await runCli(["upgrade", "--json"], io(root, output, errors));
    if (planCode !== 0) throw new Error(`${errors.join(" ")} ${output.join(" ")}`);
    const plan = JSON.parse(output.join("")) as {
      planId: string;
      planKind: string;
      status: string;
      stages: { knowledge: { disposition: string } };
      privacy: { credentials: string };
    };
    expect(plan).toMatchObject({
      planKind: "repository_upgrade",
      status: "ready",
      privacy: { credentials: "excluded" },
    });
    expect(plan.stages.knowledge.disposition).toBe("safe_apply");
    await expect(access(resolve(root, "docs/knowledge/index.md"))).rejects.toThrow();

    await writeFile(resolve(root, "main.ts"), "export const value = false;\n");
    expect(
      await runCli(["upgrade", "--apply", "--approval", plan.planId], io(root, [], errors)),
    ).toBe(1);
    expect(errors.join(" ")).toContain("exact current repository upgrade plan");
    await expect(access(resolve(root, "docs/knowledge/index.md"))).rejects.toThrow();
  });

  it("applies every generated-only stage, migrates loose skills, lints, and stops at authority boundaries", async () => {
    const root = await repository();
    const skill = resolve(root, ".agents/skills/reviewer");
    await mkdir(skill, { recursive: true });
    await writeFile(
      resolve(skill, "SKILL.md"),
      "---\nname: reviewer\ndescription: Review bounded repository changes.\n---\n\nReview the requested files.\n",
    );

    const output: string[] = [];
    const errors: string[] = [];
    const planCode = await runCli(["upgrade", "--json"], io(root, output, errors));
    if (planCode !== 0) throw new Error(`${errors.join(" ")} ${output.join(" ")}`);
    const plan = JSON.parse(output.splice(0).join("")) as {
      planId: string;
      status: string;
      stages: { capabilities: { disposition: string; createCount: number } };
    };
    expect(plan).toMatchObject({
      status: "ready",
      stages: { capabilities: { disposition: "safe_apply", createCount: 1 } },
    });

    const applyCode = await runCli(
      ["upgrade", "--apply", "--approval", plan.planId, "--json"],
      io(root, output, errors),
    );
    if (applyCode !== 0) throw new Error(`${errors.join(" ")} ${output.join(" ")}`);
    const receipt = JSON.parse(output.join("")) as {
      operation: string;
      status: string;
      appliedStages: string[];
      knowledgeLint: { valid: boolean };
      pending: Array<{ reason: string }>;
    };
    expect(receipt.operation).toBe("repository_upgrade");
    expect(receipt.appliedStages).toContain("capabilities");
    expect(receipt.knowledgeLint).toEqual({ valid: true, issueCount: 0 });
    expect(["current", "pending_authority"]).toContain(receipt.status);
    expect(await readFile(resolve(root, "docs/knowledge/index.md"), "utf8")).toContain(
      "Repository knowledge",
    );
    expect(
      await readFile(resolve(root, ".lervo/capabilities/packages/reviewer@1.0.0/SKILL.md"), "utf8"),
    ).toContain("Review the requested files.");
    expect(errors).toEqual([]);
  });

  it("does not conflate first initialization with repository upgrade", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-upgrade-uninitialized-"));
    roots.push(root);
    const errors: string[] = [];
    expect(await runCli(["upgrade"], io(root, [], errors))).toBe(1);
    expect(errors.join("")).toContain("Run lervo init first");
  });

  it("keeps an existing ignore file user-owned and resumes upgrade after exact migration approval", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-upgrade-existing-ignore-"));
    roots.push(root);
    await writeFile(resolve(root, "main.ts"), "export const value = true;\n");
    await writeFile(resolve(root, ".gitignore"), "coverage/\n");
    expect(await runCli(["init", "--minimal", "--name", "ignore-fixture"], io(root, [], []))).toBe(
      0,
    );
    expect(await readFile(resolve(root, ".gitignore"), "utf8")).toBe("coverage/\n");

    const firstOutput: string[] = [];
    const errors: string[] = [];
    expect(await runCli(["upgrade", "--json"], io(root, firstOutput, errors))).toBe(0);
    const first = JSON.parse(firstOutput.join("")) as {
      status: string;
      stages: { knowledge: { disposition: string; reason: string } };
    };
    expect(first.status).toBe("pending_authority");
    expect(first.stages.knowledge).toMatchObject({
      disposition: "pending_authority",
      reason: "review_required",
    });

    const migrationOutput: string[] = [];
    expect(
      await runCli(["migrate", "knowledge", "--json"], io(root, migrationOutput, errors)),
      errors.join(""),
    ).toBe(0);
    const migration = JSON.parse(migrationOutput.join("")) as {
      planId: string;
      userUpdates: Array<{ operationId: string; approvalHash: string; path: string }>;
    };
    const ignoreUpdate = migration.userUpdates.find((item) => item.path === ".gitignore")!;
    expect(ignoreUpdate).toBeDefined();
    expect(
      await runCli(
        [
          "migrate",
          "knowledge",
          "--apply",
          migration.planId,
          "--approve-item",
          `${ignoreUpdate.operationId}=${ignoreUpdate.approvalHash}`,
          "--json",
        ],
        io(root, [], errors),
      ),
      errors.join(""),
    ).toBe(0);
    expect(await readFile(resolve(root, ".gitignore"), "utf8")).toContain("coverage/\n");
    expect(await readFile(resolve(root, ".gitignore"), "utf8")).toContain("docs/knowledge/\n");

    const secondOutput: string[] = [];
    expect(await runCli(["upgrade", "--json"], io(root, secondOutput, errors))).toBe(0);
    expect(JSON.parse(secondOutput.join(""))).toMatchObject({ status: "ready" });
    expect(errors).toEqual([]);
  });
});
