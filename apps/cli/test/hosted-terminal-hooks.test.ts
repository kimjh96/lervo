import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createClaudeHostedSessionAdapter } from "@lervo/adapter-claude";
import { createCodexHostedSessionAdapter } from "@lervo/adapter-codex";
import { afterEach, describe, expect, it } from "vitest";

import { hostedTerminalHooks, missingTerminalHookEvents } from "../src/hosted-terminal-hooks.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const launcher = ".lervo/generated/terminal-hooks/runtime-v2.mjs";
const projectCommand = `node "$(git rev-parse --show-toplevel)/${launcher}" --provider claude --contract 2`;

async function worktree(files: Record<string, string>): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lervo-hooks-")));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}

const settings = (events: string[], command = projectCommand) =>
  JSON.stringify({
    hooks: Object.fromEntries(
      events.map((event) => [event, [{ hooks: [{ type: "command", command, timeout: 30 }] }]]),
    ),
  });

describe("the terminal hooks a hosted session adds", () => {
  it("adds every event in a worktree without project hooks", async () => {
    const root = await worktree({});
    expect(await missingTerminalHookEvents(root)).toEqual([
      "SessionStart",
      "UserPromptSubmit",
      "Stop",
    ]);
  });

  it("adds nothing where the project hooks every event with its launcher present", async () => {
    const root = await worktree({
      ".claude/settings.json": settings(["SessionStart", "UserPromptSubmit", "Stop"]),
      [launcher]: "// launcher\n",
    });
    expect(await missingTerminalHookEvents(root)).toEqual([]);
    expect(
      await hostedTerminalHooks(createClaudeHostedSessionAdapter("/opt/claude"), root, "/none"),
    ).toBe(undefined);
  });

  it("adds only the events an older project setup lacks", async () => {
    const root = await worktree({
      ".claude/settings.json": settings(["UserPromptSubmit", "Stop"]),
      [launcher]: "// launcher\n",
    });
    expect(
      await hostedTerminalHooks(createClaudeHostedSessionAdapter("/opt/claude"), root, "/none"),
    ).toEqual({
      command: "lervo terminal hook --provider claude --contract 2",
      events: ["SessionStart"],
      via: "cli",
    });
  });

  it("runs the host launcher beside the runtime store when the install has one", async () => {
    const root = await worktree({});
    const store = await worktree({ "launcher.mjs": "// host launcher\n" });
    const launcherPath = join(store, "launcher.mjs");
    expect(
      await hostedTerminalHooks(
        createClaudeHostedSessionAdapter("/opt/claude"),
        root,
        launcherPath,
      ),
    ).toEqual({
      command: `node ${JSON.stringify(launcherPath)} --provider claude --contract 2`,
      events: ["SessionStart", "UserPromptSubmit", "Stop"],
      via: "launcher",
    });
  });

  it("treats a project hook whose launcher is missing, or an unreadable file, as absent", async () => {
    const missingLauncher = await worktree({
      ".claude/settings.json": settings(["SessionStart", "UserPromptSubmit", "Stop"]),
    });
    expect(await missingTerminalHookEvents(missingLauncher)).toHaveLength(3);
    const broken = await worktree({ ".claude/settings.json": "{ not json" });
    expect(await missingTerminalHookEvents(broken)).toHaveLength(3);
  });

  it("counts the installed CLI's hook in local settings, and adds nothing for a provider without hooks", async () => {
    const root = await worktree({
      ".claude/settings.local.json": settings(
        ["SessionStart", "UserPromptSubmit", "Stop"],
        "lervo terminal hook --provider claude --contract 2",
      ),
    });
    expect(await missingTerminalHookEvents(root)).toEqual([]);
    const bare = await worktree({});
    expect(
      await hostedTerminalHooks(createCodexHostedSessionAdapter("/opt/codex"), bare, "/none"),
    ).toBe(undefined);
  });
});
