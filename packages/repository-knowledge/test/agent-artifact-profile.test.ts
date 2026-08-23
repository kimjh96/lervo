import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  compileRepositoryKnowledgeCandidate,
  createKnowledgeMigrationPlan,
  applyKnowledgeMigrationPlan,
  defaultRepositoryKnowledgePolicy,
  repositoryAgentArtifactForPath,
  lintRepositoryKnowledge,
  scanRepositoryKnowledge,
  sha256,
  summarizeRepositoryAgentArtifacts,
  type SemanticCompilerEnvelope,
} from "../src/index.js";

const roots: string[] = [];

async function fixtureRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-agent-artifacts-"));
  roots.push(root);
  return root;
}

async function put(root: string, path: string, content: string): Promise<void> {
  await mkdir(resolve(root, path, ".."), { recursive: true });
  await writeFile(resolve(root, path), content);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("repository agent artifact profiles", () => {
  it.each([
    ["AGENTS.md", "shared", "behavioral_instruction", "canonical", "semantic_source"],
    ["packages/api/AGENTS.override.md", "codex", "behavioral_instruction", "provider_specific_preserve", "semantic_source"],
    [".claude/rules/api.md", "claude", "behavioral_instruction", "provider_specific_review", "semantic_source"],
    [".agents/skills/deploy/SKILL.md", "shared", "skill", "portable_skill", "semantic_source"],
    [".claude/commands/release.md", "claude", "legacy_command", "workflow_review", "semantic_source"],
    [".codex/rules/default.rules", "codex", "execution_policy", "execution_policy_preserve", "local_inventory_only"],
    [".claude/settings.json", "claude", "client_configuration", "provider_specific_preserve", "local_inventory_only"],
    [".claude/output-styles/concise.md", "claude", "behavioral_instruction", "provider_specific_preserve", "semantic_source"],
    [".claude/workflows/release.md", "claude", "legacy_command", "nonstandard_preserve", "local_inventory_only"],
    [".claude/agent-memory/reviewer/MEMORY.md", "claude", "client_configuration", "provider_specific_preserve", "local_inventory_only"],
    [".worktreeinclude", "claude", "client_configuration", "provider_specific_preserve", "local_inventory_only"],
    [".claude/.worktreeinclude", "claude", "client_configuration", "nonstandard_preserve", "local_inventory_only"],
    [".claude/hooks.json", "claude", "lifecycle_hook", "nonstandard_preserve", "local_inventory_only"],
    [".claude-plugin/plugin.json", "claude", "client_configuration", "provider_specific_preserve", "local_inventory_only"],
    ["apps/web/.mcp.json", "claude", "tool_configuration", "provider_specific_preserve", "local_inventory_only"],
    [".agents/rules/custom.md", "unknown", "unknown", "nonstandard_preserve", "local_inventory_only"],
  ] as const)("classifies %s without claiming that it was loaded", (path, provider, role, migrationDisposition, contentHandling) => {
    expect(repositoryAgentArtifactForPath(path)).toMatchObject({
      provider,
      role,
      migrationDisposition,
      contentHandling,
    });
  });

  it("does not claim provider discovery for case-mismatched near misses", () => {
    expect(repositoryAgentArtifactForPath("agents.md")).toBeUndefined();
    expect(repositoryAgentArtifactForPath(".agents/skills/deploy/skill.md")).toMatchObject({
      role: "skill_resource",
      discovery: "on_demand",
    });
  });

  it("distinguishes repository provider directories from nested project surfaces", () => {
    expect(repositoryAgentArtifactForPath(".claude/rules/api.md")).toMatchObject({ scope: "repository" });
    expect(repositoryAgentArtifactForPath(".codex/config.toml")).toMatchObject({ scope: "repository" });
    expect(repositoryAgentArtifactForPath("apps/web/.mcp.json")).toMatchObject({ scope: "subtree" });
    expect(repositoryAgentArtifactForPath("packages/api/AGENTS.md")).toMatchObject({ scope: "subtree" });
  });

  it("keeps execution policy, hooks, tool config, agent definitions, and unknown .agents bytes out of semantic compilation", async () => {
    const root = await fixtureRepository();
    const semanticFiles = new Map([
      ["AGENTS.md", "# Shared instructions\n\nbehavioral-semantic-fixture\n"],
      [".claude/rules/api.md", "# API rules\n\nclaude-rule-semantic-fixture\n"],
      [".agents/skills/shared/SKILL.md", "---\nname: shared\ndescription: Shared fixture skill\n---\n\nskill-semantic-fixture\n"],
      [".claude/commands/release.md", "# Release\n\nworkflow-semantic-fixture\n"],
    ]);
    const inventoryOnlyFiles = new Map([
      [".codex/rules/default.rules", "rules-private-fixture"],
      [".codex/config.toml", 'fixture = "config-private-fixture"\n'],
      [".codex/hooks.json", '{"fixture":"hooks-private-fixture"}\n'],
      [".codex/agents/reviewer.toml", 'fixture = "codex-agent-private-fixture"\n'],
      [".claude/settings.json", '{"fixture":"settings-private-fixture"}\n'],
      [".claude/settings.local.json", '{"fixture":"settings-local-private-fixture"}\n'],
      [".claude/agents/reviewer.md", "claude-agent-private-fixture"],
      [".mcp.json", '{"fixture":"mcp-private-fixture"}\n'],
      [".agents/rules/custom.md", "nonstandard-agents-private-fixture"],
    ]);
    for (const [path, content] of [...semanticFiles, ...inventoryOnlyFiles]) await put(root, path, content);

    const scan = await scanRepositoryKnowledge({
      repositoryRoot: root,
      projectId: "prj_agentfixture",
      policy: defaultRepositoryKnowledgePolicy,
      observeRevision: async () => ({ status: "unavailable", reason: "git_head_unavailable" }),
    });
    const byPath = new Map(scan.sources.map((source) => [source.path, source]));
    expect(byPath.get(".claude/rules/api.md")).toMatchObject({ kind: "instruction", classification: "ordinary" });
    expect(byPath.get(".agents/skills/shared/SKILL.md")).toMatchObject({ kind: "skill_contract", classification: "ordinary" });
    expect(byPath.get(".codex/rules/default.rules")).toMatchObject({ kind: "execution_policy", classification: "sensitive" });
    expect(byPath.get(".agents/rules/custom.md")).toMatchObject({
      kind: "agent_configuration",
      classification: "sensitive",
      agentArtifact: { discovery: "not_standard" },
    });

    const envelopes: SemanticCompilerEnvelope[] = [];
    await compileRepositoryKnowledgeCandidate({
      scan,
      policyHash: sha256("fixture-policy"),
      compiler: {
        descriptor: {
          compilerId: "fixture.compiler",
          compilerVersion: "1",
          compilerBuildId: sha256("fixture-compiler"),
          provider: "codex",
          isolation: "external_no_capabilities",
        },
        async compile(envelope) {
          envelopes.push(envelope);
          return {
            schemaVersion: 1,
            concepts: [],
            relations: [],
            telemetry: {
              filesystemReads: 0,
              filesystemWrites: 0,
              shellProcesses: 0,
              networkRequests: 0,
              externalActions: 0,
              toolCalls: 0,
              complete: true,
            },
          };
        },
      },
      signal: new AbortController().signal,
    });
    const compilerInput = JSON.stringify(envelopes);
    for (const content of semanticFiles.values()) expect(compilerInput).toContain(content.trim().split("\n").at(-1));
    for (const content of inventoryOnlyFiles.values()) expect(compilerInput).not.toContain(content);

    expect(summarizeRepositoryAgentArtifacts(scan)).toMatchObject({
      total: 13,
      semanticSources: 4,
      localInventoryOnly: 9,
      reviewRequired: 2,
      nonstandard: 1,
      byRole: {
        behavioral_instruction: 2,
        skill: 1,
        legacy_command: 1,
        execution_policy: 1,
        lifecycle_hook: 1,
        client_configuration: 3,
        agent_definition: 2,
        tool_configuration: 1,
        unknown: 1,
      },
    });
  });

  it("keeps local-only agent configuration changes out of canonical structural publications", async () => {
    const root = await fixtureRepository();
    await put(root, "AGENTS.md", "# Instructions\n\nKeep repository behavior explicit.\n");
    await put(root, ".claude/settings.local.json", '{"fixture":"first-local-setting"}\n');
    await applyInitPlan(await createInitPlan({ root, projectId: "prj_agentsnapshot" }));

    const first = await createKnowledgeMigrationPlan({ repositoryRoot: root });
    await put(root, ".claude/settings.local.json", '{"fixture":"second-local-setting"}\n');
    const second = await createKnowledgeMigrationPlan({ repositoryRoot: root });
    const canonical = (plan: typeof first) => plan.operations
      .filter((operation) => !operation.path.startsWith(".lervo/state/"))
      .map((operation) => ({ path: operation.path, desiredHash: operation.desiredHash }));

    expect(second.sourceSnapshotId).not.toBe(first.sourceSnapshotId);
    expect(canonical(second)).toEqual(canonical(first));
    expect(JSON.stringify(first.operations.filter((operation) => !operation.path.startsWith(".lervo/state/"))))
      .not.toContain("first-local-setting");
    expect(JSON.stringify(second.operations.filter((operation) => !operation.path.startsWith(".lervo/state/"))))
      .not.toContain("second-local-setting");

    await applyKnowledgeMigrationPlan(second, new Date("2026-08-23T00:00:00Z"), () => undefined);
    expect(await lintRepositoryKnowledge(root)).toMatchObject({ valid: true, issues: [] });
  });
});
