import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyKnowledgeInstructionBridgePlan,
  applyKnowledgeMigrationPlan,
  createKnowledgeInstructionBridgePlan,
  createKnowledgeMigrationPlan,
  lintRepositoryKnowledge,
} from "../src/index.js";

const roots: string[] = [];

async function repository(input: { claude?: string; migrate?: boolean } = {}): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-instruction-bridge-"));
  roots.push(root);
  await writeFile(
    resolve(root, "AGENTS.md"),
    "# Agent instructions\n\nCanonical repository policy.\n",
  );
  if (input.claude !== undefined) await writeFile(resolve(root, "CLAUDE.md"), input.claude);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_instruction_bridge",
      now: new Date("2026-08-23T00:00:00.000Z"),
    }),
  );
  if (input.migrate) {
    const migration = await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" });
    await applyKnowledgeMigrationPlan(
      migration,
      new Date("2026-08-23T00:01:00.000Z"),
      () => undefined,
    );
  }
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("provider instruction bridge", () => {
  it("accepts the exact AGENTS entrypoint created by knowledge migration", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-instruction-bridge-generated-"));
    roots.push(root);
    await applyInitPlan(
      await createInitPlan({
        root,
        projectId: "prj_instruction_generated",
        now: new Date("2026-08-23T00:00:00.000Z"),
      }),
    );
    const migration = await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" });
    await applyKnowledgeMigrationPlan(
      migration,
      new Date("2026-08-23T00:01:00.000Z"),
      () => undefined,
    );

    const plan = await createKnowledgeInstructionBridgePlan({
      repositoryRoot: root,
      provider: "claude",
    });
    expect(plan.status).toBe("review_required");
    expect(plan.canonical.path).toBe("AGENTS.md");
    await applyKnowledgeInstructionBridgePlan({
      plan,
      approvedOperationId: plan.operationId,
      approvedHash: plan.approvalHash,
      now: new Date("2026-08-23T00:02:00.000Z"),
      recordApplied: () => undefined,
    });

    expect(await readFile(resolve(root, "CLAUDE.md"), "utf8")).toContain("@AGENTS.md\n");
    expect((await lintRepositoryKnowledge(root)).valid).toBe(true);
    const replan = await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" });
    expect(replan.operations.every((operation) => operation.action === "unchanged")).toBe(true);
  });

  it("creates a thin Claude entrypoint for a new repository and materializes its knowledge", async () => {
    const root = await repository();
    const plan = await createKnowledgeInstructionBridgePlan({
      repositoryRoot: root,
      provider: "claude",
    });
    expect(plan.status).toBe("review_required");
    expect(plan.target).toMatchObject({ path: "CLAUDE.md", action: "create", beforeHash: null });
    expect(plan.profile).toMatchObject({
      profileId: "claude_agents_import_v1",
      canonicalPath: "AGENTS.md",
    });
    expect(
      plan.operations.some(
        (item) => item.path === plan.bridgeRecordPath && item.action === "create",
      ),
    ).toBe(true);

    await applyKnowledgeInstructionBridgePlan({
      plan,
      approvedOperationId: plan.operationId,
      approvedHash: plan.approvalHash,
      now: new Date("2026-08-23T00:02:00.000Z"),
      recordApplied: () => undefined,
    });

    expect(await readFile(resolve(root, "CLAUDE.md"), "utf8")).toBe(
      [
        "<!-- lervo:begin block=provider_entry schema=1 -->",
        "@AGENTS.md",
        "<!-- lervo:end block=provider_entry -->",
        "",
      ].join("\n"),
    );
    expect(await readFile(resolve(root, plan.bridgeRecordPath), "utf8")).toContain(
      "claude_agents_import_v1",
    );
    expect((await lintRepositoryKnowledge(root)).valid).toBe(true);
    const current = await createKnowledgeInstructionBridgePlan({
      repositoryRoot: root,
      provider: "claude",
    });
    expect(current.status).toBe("current");
    expect(current.operations.every((item) => item.action === "unchanged")).toBe(true);
  });

  it("does not regenerate canonical bridge outputs after a Claude hook updates local metrics", async () => {
    const root = await repository({ migrate: true });
    const bridge = await createKnowledgeInstructionBridgePlan({
      repositoryRoot: root,
      provider: "claude",
    });
    await applyKnowledgeInstructionBridgePlan({
      plan: bridge,
      approvedOperationId: bridge.operationId,
      approvedHash: bridge.approvalHash,
      now: new Date("2026-08-23T00:02:00.000Z"),
      recordApplied: () => undefined,
    });

    await mkdir(resolve(root, ".claude/metrics"), { recursive: true });
    await writeFile(
      resolve(root, ".claude/metrics/commit_rules.jsonl"),
      '{"event":"commit-hook"}\n',
    );

    const localRefresh = await createKnowledgeInstructionBridgePlan({
      repositoryRoot: root,
      provider: "claude",
    });
    expect(
      localRefresh.operations
        .filter((item) => item.action !== "unchanged")
        .map((item) => ({ path: item.path, action: item.action })),
    ).toEqual([
      { path: ".lervo/state/knowledge/current/impact.json", action: "update" },
      { path: ".lervo/state/knowledge/current/inventory.json", action: "update" },
      { path: ".lervo/state/knowledge/current/source-units.json", action: "update" },
      {
        path: ".lervo/state/knowledge/current/structural/manifests/current.json",
        action: "update",
      },
    ]);
    expect(localRefresh.status).toBe("ready");
    await applyKnowledgeInstructionBridgePlan({
      plan: localRefresh,
      now: new Date("2026-08-23T00:03:00.000Z"),
      recordApplied: () => undefined,
    });

    const current = await createKnowledgeInstructionBridgePlan({
      repositoryRoot: root,
      provider: "claude",
    });
    expect(current.status).toBe("current");
    expect(current.operations.every((item) => item.action === "unchanged")).toBe(true);
  }, 60_000);

  it("updates only provider_entry and preserves every unmanaged byte", async () => {
    const before = [
      "# User Claude notes",
      "",
      "Keep this prefix exactly.",
      "",
      "<!-- lervo:begin block=provider_entry schema=1 -->",
      "- Canonical instructions: `AGENTS.md`",
      "<!-- lervo:end block=provider_entry -->",
      "",
      "Keep this suffix exactly.",
      "",
    ].join("\n");
    const root = await repository({ claude: before, migrate: true });
    const plan = await createKnowledgeInstructionBridgePlan({
      repositoryRoot: root,
      provider: "claude",
    });
    expect(plan.target.action).toBe("update");
    await expect(
      applyKnowledgeInstructionBridgePlan({
        plan,
        approvedOperationId: plan.operationId,
        approvedHash: `sha256:${"0".repeat(64)}`,
        now: new Date("2026-08-23T00:02:00.000Z"),
        recordApplied: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "knowledge_approval_required" });
    expect(await readFile(resolve(root, "CLAUDE.md"), "utf8")).toBe(before);

    await applyKnowledgeInstructionBridgePlan({
      plan,
      approvedOperationId: plan.operationId,
      approvedHash: plan.approvalHash,
      now: new Date("2026-08-23T00:02:00.000Z"),
      recordApplied: () => undefined,
    });
    const after = await readFile(resolve(root, "CLAUDE.md"), "utf8");
    expect(after).toBe(before.replace("- Canonical instructions: `AGENTS.md`\n", "@AGENTS.md\n"));
    expect((await lintRepositoryKnowledge(root)).valid).toBe(true);
  });

  it("applies generated record and navigation without item approval when the target is already current", async () => {
    const currentTarget = [
      "<!-- lervo:begin block=provider_entry schema=1 -->",
      "@AGENTS.md",
      "<!-- lervo:end block=provider_entry -->",
      "",
    ].join("\n");
    const root = await repository({ claude: currentTarget });
    const plan = await createKnowledgeInstructionBridgePlan({
      repositoryRoot: root,
      provider: "claude",
    });
    expect(plan.status).toBe("ready");
    expect(plan.target.action).toBe("unchanged");
    await applyKnowledgeInstructionBridgePlan({
      plan,
      now: new Date("2026-08-23T00:02:00.000Z"),
      recordApplied: () => undefined,
    });
    expect(await readFile(resolve(root, "CLAUDE.md"), "utf8")).toBe(currentTarget);
    expect((await lintRepositoryKnowledge(root)).valid).toBe(true);
    expect(
      (await createKnowledgeInstructionBridgePlan({ repositoryRoot: root, provider: "claude" }))
        .status,
    ).toBe("current");
  });

  it("appends a bounded managed bridge to an unmanaged existing provider file after exact approval", async () => {
    const root = await repository({
      claude: "# User-owned Claude policy\n\nDo not replace this.\n",
      migrate: true,
    });
    const plan = await createKnowledgeInstructionBridgePlan({
      repositoryRoot: root,
      provider: "claude",
    });
    expect(plan).toMatchObject({ status: "review_required", target: { action: "update" } });
    expect(plan.target.classification).toBe("unresolved_mixed_user_content");
    await applyKnowledgeInstructionBridgePlan({
      plan,
      approvedOperationId: plan.operationId,
      approvedHash: plan.approvalHash,
      now: new Date("2026-08-23T00:02:00.000Z"),
      recordApplied: () => undefined,
    });
    expect(await readFile(resolve(root, "CLAUDE.md"), "utf8")).toBe(
      [
        "# User-owned Claude policy",
        "",
        "Do not replace this.",
        "",
        "<!-- lervo:begin block=provider_entry schema=1 -->",
        "@AGENTS.md",
        "<!-- lervo:end block=provider_entry -->",
        "",
      ].join("\n"),
    );
  });

  it("rolls back target, record, concepts, and navigation when event recording fails", async () => {
    const root = await repository();
    const plan = await createKnowledgeInstructionBridgePlan({
      repositoryRoot: root,
      provider: "claude",
    });
    await expect(
      applyKnowledgeInstructionBridgePlan({
        plan,
        approvedOperationId: plan.operationId,
        approvedHash: plan.approvalHash,
        now: new Date("2026-08-23T00:02:00.000Z"),
        recordApplied: () => {
          throw new Error("event unavailable");
        },
      }),
    ).rejects.toMatchObject({ code: "knowledge_apply_failed" });
    await expect(access(resolve(root, "CLAUDE.md"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(resolve(root, plan.bridgeRecordPath))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
