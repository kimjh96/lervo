import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyTerminalIntegrationPlan,
  createTerminalIntegrationPlan,
  TERMINAL_HOOK_LAUNCHER_MAXIMUM_BYTES,
  terminalHookCommand,
} from "../src/index.js";

const roots: string[] = [];
const runtimeContent = "#!/usr/bin/env node\nprocess.stdout.write('{}\\n');\n";

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-terminal-integration-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_terminal_integration",
      now: new Date("2026-08-24T00:00:00.000Z"),
    }),
  );
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("terminal integration migration", () => {
  it("creates Codex and Claude hooks only after one exact content-bound approval", async () => {
    const root = await repository();
    const plan = await createTerminalIntegrationPlan(root, runtimeContent);
    expect(plan.status).toBe("ready");
    expect(plan.targets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: "codex", action: "create" }),
        expect.objectContaining({ provider: "claude", action: "create" }),
      ]),
    );
    // ADR-0561: no approval is asked, but a plan that went stale after planning still writes
    // nothing.
    await expect(
      applyTerminalIntegrationPlan({
        plan: { ...plan, planId: "ktermplan_000000000000000000000000" },
        runtimeContent,
        now: new Date(),
        recordApplied: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "knowledge_plan_stale" });
    await expect(access(resolve(root, ".codex/hooks.json"))).rejects.toMatchObject({
      code: "ENOENT",
    });

    await applyTerminalIntegrationPlan({
      plan,
      runtimeContent,
      now: new Date("2026-08-24T00:01:00.000Z"),
      recordApplied: () => undefined,
    });
    expect(
      JSON.parse(await readFile(resolve(root, ".codex/hooks.json"), "utf8")).hooks
        .UserPromptSubmit[0].hooks[0].command,
    ).toBe(terminalHookCommand("codex"));
    expect(
      JSON.parse(await readFile(resolve(root, ".claude/settings.json"), "utf8")).hooks.Stop[0]
        .hooks[0].command,
    ).toBe(terminalHookCommand("claude"));
    // ADR-0562 section 4: Claude also answers each session epoch's start; Codex does not yet.
    const claudeHooks = JSON.parse(
      await readFile(resolve(root, ".claude/settings.json"), "utf8"),
    ).hooks;
    expect(Object.keys(claudeHooks).sort()).toEqual(["SessionStart", "Stop", "UserPromptSubmit"]);
    expect(claudeHooks.SessionStart[0].hooks[0].command).toBe(terminalHookCommand("claude"));
    expect(
      Object.keys(
        JSON.parse(await readFile(resolve(root, ".codex/hooks.json"), "utf8")).hooks,
      ).sort(),
    ).toEqual(["Stop", "UserPromptSubmit"]);
    expect(
      await readFile(resolve(root, ".lervo/generated/terminal-hooks/runtime-v2.mjs"), "utf8"),
    ).toBe(runtimeContent);
    expect((await createTerminalIntegrationPlan(root, runtimeContent)).status).toBe("current");
  });

  it("preserves existing Claude settings and hooks while appending Lervo-owned handlers", async () => {
    const root = await repository();
    await mkdir(resolve(root, ".claude"));
    await writeFile(
      resolve(root, ".claude/settings.json"),
      [
        "{",
        "  // retained comment",
        '  "permissions": { "allow": ["Read"] },',
        '  "hooks": {',
        '    "UserPromptSubmit": [{ "matcher": "fixture", "hooks": [{ "type": "command", "command": "existing-hook" }] }]',
        "  }",
        "}",
        "",
      ].join("\n"),
    );
    const plan = await createTerminalIntegrationPlan(root, runtimeContent);
    await applyTerminalIntegrationPlan({
      plan,
      runtimeContent,
      now: new Date(),
      recordApplied: () => undefined,
    });
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
    await writeFile(
      resolve(root, ".claude/settings.json"),
      '{"disableAllHooks":true,"fixture":"preserve"}\n',
    );
    await writeFile(resolve(root, ".codex/config.toml"), "[features]\nhooks = false\n");
    const plan = await createTerminalIntegrationPlan(root, runtimeContent);
    expect(plan.status).toBe("blocked");
    expect(plan.operations).toEqual([]);
    expect(plan.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: "claude", code: "hooks_disabled" }),
        expect.objectContaining({ provider: "codex", code: "hooks_disabled" }),
      ]),
    );
    expect(await readFile(resolve(root, ".claude/settings.json"), "utf8")).toContain(
      '"fixture":"preserve"',
    );
  });

  it("updates only the generated runtime without requiring user-owned hook approval", async () => {
    const root = await repository();
    const initial = await createTerminalIntegrationPlan(root, runtimeContent);
    await applyTerminalIntegrationPlan({
      plan: initial,
      runtimeContent,
      now: new Date(),
      recordApplied: () => undefined,
    });
    const nextRuntime = `${runtimeContent}// patched runtime\n`;
    const update = await createTerminalIntegrationPlan(root, nextRuntime);
    expect(update).toMatchObject({
      status: "ready",
      approvalHash: null,
      runtime: { action: "update" },
    });
    await applyTerminalIntegrationPlan({
      plan: update,
      runtimeContent: nextRuntime,
      now: new Date(),
      recordApplied: () => undefined,
    });
    expect(
      await readFile(resolve(root, ".lervo/generated/terminal-hooks/runtime-v2.mjs"), "utf8"),
    ).toBe(nextRuntime);
  });

  it("accepts a launcher within 16 KiB and blocks one above it", async () => {
    const root = await repository();
    const initial = await createTerminalIntegrationPlan(root, runtimeContent);
    await applyTerminalIntegrationPlan({
      plan: initial,
      runtimeContent,
      now: new Date(),
      recordApplied: () => undefined,
    });
    const padded = (bytes: number) =>
      `${runtimeContent}//${"x".repeat(bytes - Buffer.byteLength(runtimeContent) - 3)}\n`;
    const large = padded(TERMINAL_HOOK_LAUNCHER_MAXIMUM_BYTES);
    const update = await createTerminalIntegrationPlan(root, large);
    expect(update).toMatchObject({ status: "ready", blockers: [], runtime: { action: "update" } });
    await applyTerminalIntegrationPlan({
      plan: update,
      runtimeContent: large,
      now: new Date(),
      recordApplied: () => undefined,
    });
    expect((await createTerminalIntegrationPlan(root, large)).status).toBe("current");

    const oversized = padded(TERMINAL_HOOK_LAUNCHER_MAXIMUM_BYTES + 1);
    expect((await createTerminalIntegrationPlan(root, oversized)).blockers).toEqual([
      expect.objectContaining({ code: "runtime_invalid" }),
    ]);
  });

  it("gives a repeated byte transition a distinct plan after an intervening application event", async () => {
    const root = await repository();
    const initial = await createTerminalIntegrationPlan(root, runtimeContent, null);
    await applyTerminalIntegrationPlan({
      plan: initial,
      runtimeContent,
      now: new Date(),
      recordApplied: () => undefined,
    });

    const nextRuntime = `${runtimeContent}// patched runtime\n`;
    const firstTransition = await createTerminalIntegrationPlan(
      root,
      nextRuntime,
      "evt_first_application",
    );
    await applyTerminalIntegrationPlan({
      plan: firstTransition,
      runtimeContent: nextRuntime,
      now: new Date(),
      recordApplied: () => undefined,
    });
    const reverse = await createTerminalIntegrationPlan(
      root,
      runtimeContent,
      "evt_reverse_application",
    );
    await applyTerminalIntegrationPlan({
      plan: reverse,
      runtimeContent,
      now: new Date(),
      recordApplied: () => undefined,
    });
    const repeatedTransition = await createTerminalIntegrationPlan(
      root,
      nextRuntime,
      "evt_repeated_application",
    );

    expect(repeatedTransition.planId).not.toBe(firstTransition.planId);
    expect(repeatedTransition.operationId).toBe(firstTransition.operationId);
    expect(repeatedTransition.priorApplicationEventId).toBe("evt_repeated_application");
  });
});
