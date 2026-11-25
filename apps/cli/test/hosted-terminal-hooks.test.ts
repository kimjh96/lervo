import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { createClaudeHostedSessionAdapter } from "@lervo/adapter-claude";
import { createCodexHostedSessionAdapter } from "@lervo/adapter-codex";
import { afterEach, describe, expect, it } from "vitest";

import { hostedTerminalHooks } from "../src/hosted-terminal-hooks.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const launcher = ".lervo/generated/terminal-hooks/runtime-v2.mjs";
const projectCommand = `node "$(git rev-parse --show-toplevel)/${launcher}" --provider claude --contract 2`;
const claude = createClaudeHostedSessionAdapter("/opt/claude");

async function folder(files: Record<string, string>): Promise<string> {
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

/** A user home without Claude settings, and no host launcher, unless a test says otherwise. */
async function plan(worktree: string, options: { home?: string; launcher?: string } = {}) {
  const home = options.home ?? (await folder({}));
  return hostedTerminalHooks(claude, worktree, {
    home,
    environment: {},
    launcher: options.launcher ?? join(home, "missing-launcher.mjs"),
  });
}

describe("the terminal hooks a hosted session adds", () => {
  it("adds every event in a worktree without hooks, through the CLI when no host launcher exists", async () => {
    expect(await plan(await folder({}))).toEqual({
      command: "lervo terminal hook --provider claude --contract 2",
      events: [{ name: "SessionStart" }, { name: "UserPromptSubmit" }, { name: "Stop" }],
      via: "cli",
    });
  });

  it("runs the host launcher when the install has one", async () => {
    const store = await folder({ "launcher.mjs": "// host launcher\n" });
    const launcherPath = join(store, "launcher.mjs");
    expect(await plan(await folder({}), { launcher: launcherPath })).toMatchObject({
      command: `node ${JSON.stringify(launcherPath)} --provider claude --contract 2`,
      via: "launcher",
    });
  });

  it("adds nothing where the project, with comments and a symlinked file, hooks every event", async () => {
    const real = await folder({
      "settings.json": `// Lervo's hooks\n${settings(["SessionStart", "UserPromptSubmit", "Stop"]).slice(0, -1)},}\n`,
    });
    const worktree = await folder({ [launcher]: "// launcher\n" });
    await mkdir(join(worktree, ".claude"));
    await symlink(join(real, "settings.json"), join(worktree, ".claude/settings.json"));
    expect(await plan(worktree)).toBeUndefined();
  });

  it("counts hooks in the user's settings, and a project hook only while its launcher exists", async () => {
    const home = await folder({
      ".claude/settings.json": settings(
        ["SessionStart", "UserPromptSubmit", "Stop"],
        "lervo terminal hook --provider claude --contract 2",
      ),
    });
    expect(await plan(await folder({}), { home })).toBeUndefined();
    const noLauncher = await folder({
      ".claude/settings.json": settings(["SessionStart", "UserPromptSubmit", "Stop"]),
    });
    expect((await plan(noLauncher))?.events).toHaveLength(3);
  });

  it("adds only the SessionStart sources a project's matcher leaves out", async () => {
    const worktree = await folder({
      [launcher]: "// launcher\n",
      ".claude/settings.json": JSON.stringify({
        hooks: {
          SessionStart: [
            { matcher: "startup|clear", hooks: [{ type: "command", command: projectCommand }] },
          ],
          UserPromptSubmit: [{ hooks: [{ type: "command", command: projectCommand }] }],
          Stop: [{ hooks: [{ type: "command", command: projectCommand }] }],
        },
      }),
    });
    expect((await plan(worktree))?.events).toEqual([
      { name: "SessionStart", matcher: "resume|compact" },
    ]);
  });

  it("adds nothing for a provider that takes no hooks", async () => {
    expect(
      await hostedTerminalHooks(createCodexHostedSessionAdapter("/opt/codex"), await folder({})),
    ).toBeUndefined();
  });
});
