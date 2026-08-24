import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import { applyTerminalIntegrationPlan, createTerminalIntegrationPlan, terminalHookCommand } from "../src/index.js";

const roots: string[] = [];

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-terminal-integration-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_terminal_integration", now: new Date("2026-08-24T00:00:00.000Z") }));
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("terminal integration migration", () => {
  it("creates Codex and Claude hooks only after one exact content-bound approval", async () => {
    const root = await repository();
    const plan = await createTerminalIntegrationPlan(root);
    expect(plan.status).toBe("review_required");
    expect(plan.targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "codex", action: "create" }),
      expect.objectContaining({ provider: "claude", action: "create" }),
    ]));
    await expect(applyTerminalIntegrationPlan({
      plan,
      approvedOperationId: plan.operationId,
      approvedHash: `sha256:${"0".repeat(64)}`,
      now: new Date(),
      recordApplied: () => undefined,
    })).rejects.toMatchObject({ code: "knowledge_approval_required" });
    await expect(access(resolve(root, ".codex/hooks.json"))).rejects.toMatchObject({ code: "ENOENT" });

    await applyTerminalIntegrationPlan({
      plan,
      approvedOperationId: plan.operationId,
      approvedHash: plan.approvalHash,
      now: new Date("2026-08-24T00:01:00.000Z"),
      recordApplied: () => undefined,
    });
    expect(JSON.parse(await readFile(resolve(root, ".codex/hooks.json"), "utf8")).hooks.UserPromptSubmit[0].hooks[0].command).toBe(terminalHookCommand("codex"));
    expect(JSON.parse(await readFile(resolve(root, ".claude/settings.json"), "utf8")).hooks.Stop[0].hooks[0].command).toBe(terminalHookCommand("claude"));
    expect((await createTerminalIntegrationPlan(root)).status).toBe("current");
  });

  it("preserves existing Claude settings and hooks while appending Lervo-owned handlers", async () => {
    const root = await repository();
    await mkdir(resolve(root, ".claude"));
    await writeFile(resolve(root, ".claude/settings.json"), [
      "{",
      "  // retained comment",
      "  \"permissions\": { \"allow\": [\"Read\"] },",
      "  \"hooks\": {",
      "    \"UserPromptSubmit\": [{ \"matcher\": \"fixture\", \"hooks\": [{ \"type\": \"command\", \"command\": \"existing-hook\" }] }]",
      "  }",
      "}",
      "",
    ].join("\n"));
    const plan = await createTerminalIntegrationPlan(root);
    await applyTerminalIntegrationPlan({ plan, approvedOperationId: plan.operationId, approvedHash: plan.approvalHash, now: new Date(), recordApplied: () => undefined });
    const after = await readFile(resolve(root, ".claude/settings.json"), "utf8");
    expect(after).toContain("// retained comment");
    expect(after).toContain("existing-hook");
    const value = JSON.parse(after.replace("// retained comment", ""));
    expect(value.permissions).toEqual({ allow: ["Read"] });
    expect(value.hooks.UserPromptSubmit).toHaveLength(2);
    expect(value.hooks.Stop).toHaveLength(1);
  });

  it("blocks instead of changing intentionally disabled or conflicting hooks", async () => {
    const root = await repository();
    await mkdir(resolve(root, ".claude"));
    await mkdir(resolve(root, ".codex"));
    await writeFile(resolve(root, ".claude/settings.json"), '{"disableAllHooks":true,"fixture":"preserve"}\n');
    await writeFile(resolve(root, ".codex/config.toml"), "[features]\nhooks = false\n");
    const plan = await createTerminalIntegrationPlan(root);
    expect(plan.status).toBe("blocked");
    expect(plan.operations).toEqual([]);
    expect(plan.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ provider: "claude", code: "hooks_disabled" }),
      expect.objectContaining({ provider: "codex", code: "hooks_disabled" }),
    ]));
    expect(await readFile(resolve(root, ".claude/settings.json"), "utf8")).toContain('"fixture":"preserve"');
  });
});
