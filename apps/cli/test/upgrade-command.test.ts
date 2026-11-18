import { mkdtempSync } from "node:fs";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  createRepositoryLayoutMigrationPlan,
  lintRepositoryKnowledge,
  sha256,
  shardedKnowledgeArtifactPath,
  stableId,
} from "@lervo/repository-knowledge";
import { loadProjectManifest } from "@lervo/project";
import { listAgents, registerAgent } from "@lervo/agent-workforce";
import { resolveRepositoryCoordinationHome } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import { runCli as runUnisolatedCli } from "../src/main.js";
import { commitRepository } from "./committed-repository.js";
import { planCrossCheck } from "./plan-cross-check-fixture.js";
import { withIsolatedUpgradeHost } from "./upgrade-host-isolation.js";

const runCli = withIsolatedUpgradeHost(runUnisolatedCli);

/** Keeps upgrade applies off the developer host's real background-resident admission. */
const isolatedAdmission = {
  knowledgeCycleAdmission: {
    directory: mkdtempSync(resolve(tmpdir(), "lervo-upgrade-admission-")),
  },
};

const roots: string[] = [];
const execute = promisify(execFile);

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

/** A repository whose first reviewed knowledge plan adds a route to a user-owned ignore file. */
async function ignoreFixture(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-upgrade-existing-ignore-"));
  roots.push(root);
  await writeFile(resolve(root, "main.ts"), "export const value = true;\n");
  await writeFile(resolve(root, ".gitignore"), "coverage/\n");
  expect(await runCli(["init", "--minimal", "--name", "ignore-fixture"], io(root, [], []))).toBe(0);
  expect(await readFile(resolve(root, ".gitignore"), "utf8")).toBe("coverage/\n");
  return root;
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
  it("converges enumerated AGENTS routes while preserving historical pattern blocks", async () => {
    const root = await repository();
    await writeFile(
      resolve(root, "AGENTS.md"),
      [
        "# Existing instructions",
        "",
        "Preserve this user-owned text.",
        "",
        "<!-- lervo:begin block=repository_instruction_routes schema=1 -->",
        "## Repository instruction routes",
        "",
        "- For all repository work, read [commit messages](docs/instructions/commit-messages.md).",
        "<!-- lervo:end block=repository_instruction_routes -->",
        "",
        "<!-- lervo:begin block=development_pattern_routes schema=1 -->",
        "## Promoted development patterns",
        "",
        "- [Commit messages](docs/instructions/commit-messages.md)",
        "<!-- lervo:end block=development_pattern_routes -->",
        "",
      ].join("\n"),
    );

    const output: string[] = [];
    const errors: string[] = [];
    expect(await runCli(["upgrade", "--json"], io(root, output, errors)), errors.join("")).toBe(0);
    const plan = JSON.parse(output.splice(0).join("")) as { planId: string; status: string };
    expect(plan.status).toBe("ready");
    expect(
      await runCli(["upgrade", "--apply", "--json"], io(root, output, errors), isolatedAdmission),
      errors.join(""),
    ).toBe(0);
    const agents = await readFile(resolve(root, "AGENTS.md"), "utf8");
    expect(agents).toContain("Preserve this user-owned text.");
    expect(agents).toContain("block=repository_instruction_routes schema=2");
    expect(agents).toContain("development_pattern_routes");
    expect(agents).toContain("commit-messages.md");
    expect(Buffer.byteLength(agents)).toBeLessThan(4 * 1024);
    expect((await createRepositoryLayoutMigrationPlan({ repositoryRoot: root })).status).toBe(
      "current",
    );
    const stableAgents = await readFile(resolve(root, "AGENTS.md"), "utf8");
    output.length = 0;
    expect(await runCli(["upgrade", "--json"], io(root, output, errors)), errors.join("")).toBe(0);
    expect(["current", "lervo_debt"]).toContain(JSON.parse(output.join("")).status);
    expect(await readFile(resolve(root, "AGENTS.md"), "utf8")).toBe(stableAgents);
  }, 20_000);

  it("keeps a bridge-bound legacy AGENTS migration transactional until the bridge refreshes", async () => {
    const root = await repository();
    const agents = [
      "# Existing instructions",
      "",
      "Preserve this user-owned text.",
      "",
      "<!-- lervo:begin block=repository_instruction_routes schema=1 -->",
      "## Repository instruction routes",
      "",
      "- Read the verified current state with `lervo workstream current --context` before continuing repository work.",
      "<!-- lervo:end block=repository_instruction_routes -->",
      "",
    ].join("\n");
    const claude = [
      "<!-- lervo:begin block=provider_entry schema=1 -->",
      "@AGENTS.md",
      "<!-- lervo:end block=provider_entry -->",
      "",
    ].join("\n");
    await writeFile(resolve(root, "AGENTS.md"), agents);
    await writeFile(resolve(root, "CLAUDE.md"), claude);

    const manifest = await loadProjectManifest(root);
    expect(manifest.projectId).toBeTruthy();
    const bridgeId = stableId("kbridge", {
      projectId: manifest.projectId,
      provider: "claude",
      canonicalPath: "AGENTS.md",
      targetPath: "CLAUDE.md",
    });
    const bridgePath = shardedKnowledgeArtifactPath(
      ".lervo/knowledge/instruction-bridges",
      bridgeId,
      "yaml",
    );
    await mkdir(resolve(root, bridgePath, ".."), { recursive: true });
    await writeFile(
      resolve(root, bridgePath),
      JSON.stringify(
        {
          schemaVersion: 1,
          bridgeId,
          profile: {
            id: "claude_agents_import_v1",
            version: 1,
            provider: "claude",
            discoveryContract: "claude-code-memory-import",
          },
          canonical: { path: "AGENTS.md", contentHash: sha256(agents) },
          target: {
            path: "CLAUDE.md",
            contentHash: sha256(claude),
            blockId: "provider_entry",
            managedContentHash: sha256("@AGENTS.md\n"),
          },
        },
        null,
        2,
      ) + "\n",
    );
    expect(
      (await lintRepositoryKnowledge(root)).issues.some(
        (issue) => issue.code === "instruction_bridge_binding_stale",
      ),
    ).toBe(false);

    const output: string[] = [];
    const errors: string[] = [];
    expect(await runCli(["upgrade", "--json"], io(root, output, errors)), errors.join("\n")).toBe(
      0,
    );
    const plan = JSON.parse(output.splice(0).join("")) as { planId: string; status: string };
    expect(plan.status).toBe("ready");
    expect(
      await runCli(["upgrade", "--apply", "--json"], io(root, output, errors), isolatedAdmission),
      errors.join("\n"),
    ).toBe(0);
    expect((await lintRepositoryKnowledge(root)).valid).toBe(true);
    expect(await readFile(resolve(root, "AGENTS.md"), "utf8")).toContain(
      "block=repository_instruction_routes schema=2",
    );
  }, 20_000);

  it("plans without changing repository bytes and refuses the removed approval options", async () => {
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
      policy: { userOwnedBytes: string; providerConfiguration: string };
    };
    expect(plan).toMatchObject({
      planKind: "repository_upgrade",
      status: "ready",
      privacy: { credentials: "excluded" },
      policy: {
        userOwnedBytes: "never_automatic_outside_delegation_roots",
        providerConfiguration: "backup_apply_verify_restore",
      },
    });
    expect(plan.stages.knowledge.disposition).toBe("safe_apply");
    await expect(access(resolve(root, "docs/knowledge/index.md"))).rejects.toThrow();

    expect(
      await runCli(["upgrade", "--approval", plan.planId], io(root, [], errors), isolatedAdmission),
    ).toBe(1);
    expect(errors.join(" ")).toContain("--approval and --approve-role-binding were removed");
    const refusal: string[] = [];
    expect(
      await runCli(
        ["upgrade", "--apply", "--approve-role-binding", "--json"],
        io(root, refusal, errors),
        isolatedAdmission,
      ),
    ).toBe(1);
    expect(JSON.parse(refusal.join(""))).toMatchObject({
      status: "failed",
      error: { code: "upgrade_option_removed" },
    });
    await expect(access(resolve(root, "docs/knowledge/index.md"))).rejects.toThrow();
  });

  it("refreshes stale built-in workforce role bindings before Node reconciliation", async () => {
    const root = await repository();
    const agent = await registerAgent({ repositoryRoot: root, roleId: "developer" });
    const home = await resolveRepositoryCoordinationHome(root);
    const registryPath = resolve(home.workforce, "agents.json");
    const registry = JSON.parse(await readFile(registryPath, "utf8")) as {
      agents: Array<Record<string, unknown>>;
    };
    registry.agents[0]!.roleContractHash = `sha256:${"0".repeat(64)}`;
    registry.agents[0]!.roleProfileHash = `sha256:${"1".repeat(64)}`;
    registry.agents[0]!.capabilityHash = `sha256:${"2".repeat(64)}`;
    await writeFile(registryPath, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });

    const output: string[] = [];
    const errors: string[] = [];
    expect(await runCli(["upgrade", "--json"], io(root, output, errors)), errors.join("\n")).toBe(
      0,
    );
    const plan = JSON.parse(output.splice(0).join("")) as {
      planId: string;
      stages: { workforce: { disposition: string; staleAgentCount: number } };
    };
    expect(plan.stages.workforce).toMatchObject({
      disposition: "safe_apply",
      staleAgentCount: 1,
    });
    expect(
      await runCli(["upgrade", "--apply", "--json"], io(root, output, errors), isolatedAdmission),
      errors.join("\n"),
    ).toBe(0);
    const receipt = JSON.parse(output.join("")) as { appliedStages: string[] };
    expect(receipt.appliedStages).toContain("workforce_role_bindings");
    expect(await listAgents(root)).toEqual([
      expect.objectContaining({ agentId: agent.agentId, revision: agent.revision + 1 }),
    ]);
  }, 20_000);

  it("applies a repository role refresh without an owner approval (ADR-0561)", async () => {
    const root = await repository();
    const roleDirectory = resolve(root, ".lervo/roles");
    const rolePath = resolve(roleDirectory, "release-developer.json");
    await mkdir(roleDirectory, { recursive: true });
    const roleSource = (description: string) =>
      `${JSON.stringify(
        {
          schemaVersion: 1,
          kind: "lervo_repository_role",
          roleId: "release-developer",
          version: "1.0.0",
          extends: [{ roleId: "developer", version: "1.0.0" }],
          profile: { name: "Release Developer", description },
          checks: [],
        },
        null,
        2,
      )}\n`;
    await writeFile(rolePath, roleSource("Prepares verified release artifacts."));
    const agent = await registerAgent({ repositoryRoot: root, roleId: "release-developer" });
    await writeFile(rolePath, roleSource("Prepares verified and reproducible release artifacts."));
    const preservedRoleSource = await readFile(rolePath, "utf8");

    const output: string[] = [];
    const errors: string[] = [];
    expect(await runCli(["upgrade", "--json"], io(root, output, errors)), errors.join("\n")).toBe(
      0,
    );
    const plan = JSON.parse(output.splice(0).join("")) as {
      stages: { workforce: Record<string, unknown> };
    };
    expect(plan.stages.workforce).toMatchObject({
      disposition: "safe_apply",
      reason: "stale_repository_role_bindings",
      repositoryRoleRefreshes: [{ roleId: "release-developer", staleAgentCount: 1 }],
    });
    expect(plan.stages.workforce).not.toHaveProperty("requiredApprovals");
    const humanOutput: string[] = [];
    expect(await runCli(["upgrade"], io(root, humanOutput, errors)), errors.join("\n")).toBe(0);
    expect(humanOutput.join("\n")).toContain("repository role refresh: release-developer@1.0.0");
    expect(humanOutput.join("\n")).not.toContain("--approve-role-binding");

    expect(
      await runCli(["upgrade", "--apply", "--json"], io(root, output, errors), isolatedAdmission),
      errors.join("\n"),
    ).toBe(0);
    const receipt = JSON.parse(output.join("")) as {
      appliedStages: string[];
      notices: Array<{ stage: string; undo: string }>;
    };
    expect(receipt.appliedStages).toContain("workforce_role_bindings");
    expect(receipt.notices).toContainEqual(
      expect.objectContaining({
        stage: "workforce",
        undo: expect.stringContaining(".lervo/roles"),
      }),
    );
    expect(await listAgents(root)).toEqual([
      expect.objectContaining({ agentId: agent.agentId, revision: agent.revision + 1 }),
    ]);
    expect(await readFile(rolePath, "utf8")).toBe(preservedRoleSource);
  }, 20_000);

  it("applies every independent stage, migrates loose skills, lints, and holds an unchecked plan as Lervo debt", async () => {
    const root = await repository();
    const skill = resolve(root, ".agents/skills/reviewer");
    await mkdir(skill, { recursive: true });
    await writeFile(
      resolve(skill, "SKILL.md"),
      "---\nname: reviewer\ndescription: Review bounded repository changes.\n---\n\nReview the requested files.\n",
    );
    // A reviewed knowledge plan applies only as its own undo commit over committed sources.
    commitRepository(root);

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
      ["upgrade", "--apply", "--json"],
      io(root, output, errors),
      isolatedAdmission,
    );
    if (applyCode !== 0) throw new Error(`${errors.join(" ")} ${output.join(" ")}`);
    const receipt = JSON.parse(output.join("")) as {
      operation: string;
      status: string;
      appliedStages: string[];
      knowledgeLint: { valid: boolean };
      skippedStages: Array<{ stage: string; reason: string }>;
      pending: Array<{ reason: string }>;
    };
    expect(receipt.operation).toBe("repository_upgrade");
    expect(receipt.appliedStages).toEqual(
      expect.arrayContaining(["capabilities", "terminal_integration"]),
    );
    expect(receipt.knowledgeLint).toEqual({ valid: true, issueCount: 0 });
    // No provider is admitted here, so the reviewed plan is held rather than asked of the owner;
    // a plan that overwrites a user-owned file is held without a cross-check (invariant 5).
    const held = [
      ...receipt.skippedStages.filter((item) => item.stage === "knowledge"),
      ...receipt.pending,
    ].map((item) => item.reason);
    expect(
      held.some((reason) => ["cross_check_unavailable", "user_owned_content"].includes(reason)),
      JSON.stringify(receipt),
    ).toBe(true);
    expect(receipt.status).toBe("lervo_debt");
    expect(await readFile(resolve(root, "docs/knowledge/index.md"), "utf8")).toContain(
      "Repository knowledge",
    );
    expect(
      await readFile(resolve(root, ".lervo/capabilities/packages/reviewer@1.0.0/SKILL.md"), "utf8"),
    ).toContain("Review the requested files.");
    expect(errors).toEqual([]);
  }, 30_000);

  it("never restores a renewed convergence delegation that HEAD tracks (ADR-0478)", async () => {
    const root = await repository();
    const delegation = resolve(root, ".lervo/knowledge/convergence-delegation.json");
    const git = (...args: string[]) =>
      execute("git", [
        "-C",
        root,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=t@lervo.invalid",
        ...args,
      ]);
    await git("init", "--quiet", "-b", "main");
    await writeFile(delegation, '{"expiresAt":"2026-10-07T19:00:00.000Z"}\n');
    await git("add", "-A");
    await git("add", "-f", ".lervo/knowledge/convergence-delegation.json");
    await git("commit", "--quiet", "-m", "fixture with a tracked delegation");
    const renewed = '{"expiresAt":"2026-11-06T19:00:00.000Z"}\n';
    await writeFile(delegation, renewed);
    const skill = resolve(root, ".agents/skills/reviewer");
    await mkdir(skill, { recursive: true });
    await writeFile(
      resolve(skill, "SKILL.md"),
      "---\nname: reviewer\ndescription: Review bounded repository changes.\n---\n\nReview the requested files.\n",
    );

    const output: string[] = [];
    const errors: string[] = [];
    expect(await runCli(["upgrade", "--json"], io(root, output, errors)), errors.join("")).toBe(0);
    const plan = JSON.parse(output.splice(0).join("")) as { planId: string; status: string };
    expect(plan.status).toBe("ready");
    expect(
      await runCli(["upgrade", "--apply", "--json"], io(root, output, errors), isolatedAdmission),
      errors.join(""),
    ).toBe(0);
    const receipt = JSON.parse(output.join("")) as { appliedStages: string[] };
    expect(receipt.appliedStages).toContain("knowledge_materialization");
    expect(await readFile(delegation, "utf8")).toBe(renewed);
    expect((await git("diff", "--name-only")).stdout).toContain(
      ".lervo/knowledge/convergence-delegation.json",
    );
  }, 30_000);

  it("does not conflate first initialization with repository upgrade", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-upgrade-uninitialized-"));
    roots.push(root);
    const errors: string[] = [];
    expect(await runCli(["upgrade"], io(root, [], errors))).toBe(1);
    expect(errors.join("")).toContain("Run lervo init first");
  });

  it("holds a reviewed plan that rewrites a user-owned file as Lervo debt (AGENTS.md invariant 5)", async () => {
    const root = await ignoreFixture();
    const firstOutput: string[] = [];
    const errors: string[] = [];
    expect(await runCli(["upgrade", "--json"], io(root, firstOutput, errors))).toBe(0);
    const first = JSON.parse(firstOutput.join("")) as {
      status: string;
      stages: {
        knowledge: { disposition: string; reason: string };
        eventWriter: { disposition: string; reason: string };
      };
    };
    expect(first.status).toBe("ready");
    expect(first.stages.eventWriter).toMatchObject({
      disposition: "deferred",
      reason: "terminal_integration_must_apply_first",
    });
    // Without the owner's delegation, Lervo never rewrites the user's ignore file on its own.
    expect(first.stages.knowledge).toMatchObject({
      disposition: "lervo_debt",
      reason: "user_owned_content",
    });
    expect(first.stages.knowledge).not.toHaveProperty("layoutDecision");

    const checks = planCrossCheck("agree");
    expect(
      await runCli(["upgrade", "--apply", "--json"], io(root, [], errors), {
        ...isolatedAdmission,
        ...checks.services,
      }),
      errors.join(""),
    ).toBe(0);
    expect(checks.checked).toEqual([]);
    expect(await readFile(resolve(root, ".gitignore"), "utf8")).toBe("coverage/\n");

    // An owner command still applies it, cross-checked and committed as its undo point.
    commitRepository(root);
    const planned: string[] = [];
    expect(await runCli(["migrate", "knowledge", "--json"], io(root, planned, errors))).toBe(0);
    const plan = JSON.parse(planned.join("")) as { planId: string; status: string };
    expect(plan.status).toBe("review_required");
    expect(
      await runCli(
        ["migrate", "knowledge", "--apply", plan.planId],
        io(root, [], errors),
        checks.services,
      ),
      errors.join(""),
    ).toBe(0);
    expect(checks.checked.length).toBeGreaterThan(0);
    expect(await readFile(resolve(root, ".gitignore"), "utf8")).toContain("docs/knowledge/\n");
  }, 60_000);

  it("changes nothing when an owner command's cross-check disagrees or the file is unsaved", async () => {
    const root = await ignoreFixture();
    commitRepository(root);
    const errors: string[] = [];
    const planned: string[] = [];
    expect(await runCli(["migrate", "knowledge", "--json"], io(root, planned, errors))).toBe(0);
    const plan = JSON.parse(planned.join("")) as { planId: string };
    const disagree = planCrossCheck("disagree");
    expect(
      await runCli(
        ["migrate", "knowledge", "--apply", plan.planId],
        io(root, [], errors),
        disagree.services,
      ),
    ).toBe(1);
    expect(errors.join("")).toContain("disagreed with plan");
    expect(await readFile(resolve(root, ".gitignore"), "utf8")).toBe("coverage/\n");
    // An unsaved edit to a file the plan rewrites would enter its commit and be lost on undo.
    errors.length = 0;
    await writeFile(resolve(root, ".gitignore"), "coverage/\ndist/\n");
    const agree = planCrossCheck("agree");
    const replanned: string[] = [];
    expect(await runCli(["migrate", "knowledge", "--json"], io(root, replanned, errors))).toBe(0);
    expect(
      await runCli(
        [
          "migrate",
          "knowledge",
          "--apply",
          (JSON.parse(replanned.join("")) as { planId: string }).planId,
        ],
        io(root, [], errors),
        agree.services,
      ),
    ).toBe(1);
    expect(errors.join("")).toContain("hold uncommitted work");
    expect(agree.checked).toEqual([]);
    expect(await readFile(resolve(root, ".gitignore"), "utf8")).toBe("coverage/\ndist/\n");
  }, 60_000);
});
