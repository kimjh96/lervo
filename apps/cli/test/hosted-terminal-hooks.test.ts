import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { claudeSessionSettings, createClaudeHostedSessionAdapter } from "@lervo/adapter-claude";
import { createCodexHostedSessionAdapter } from "@lervo/adapter-codex";
import { afterEach, describe, expect, it } from "vitest";

import { hostedTerminalHooks, writtenTerminalHooks } from "../src/hosted-terminal-hooks.js";
import { loadTerminalHookLauncher } from "../src/terminal-runtime.js";

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
async function plan(
  worktree: string,
  options: { home?: string; launcher?: string; platform?: NodeJS.Platform; claims?: boolean } = {},
) {
  const home = options.home ?? (await folder({}));
  return hostedTerminalHooks(claude, worktree, {
    home,
    environment: {},
    launcher: options.launcher ?? join(home, "missing-launcher.mjs"),
    ...(options.platform === undefined ? {} : { platform: options.platform }),
    ...(options.claims === undefined ? {} : { claims: options.claims }),
  });
}

/** A store folder, whose name needs quoting, holding this CLI's launcher as `ensure` writes it. */
async function hostLauncher(content?: string): Promise<string> {
  const store = await folder({});
  const path = join(store, "it's $HOME `x`", "launcher.mjs");
  await mkdir(dirname(path));
  await writeFile(path, content ?? (await loadTerminalHookLauncher()), { mode: 0o600 });
  return path;
}

describe("the terminal hooks a hosted session adds", () => {
  it("adds every event in a worktree without hooks, through the CLI when no host launcher exists", async () => {
    expect(await plan(await folder({}))).toEqual({
      command: "lervo terminal hook --provider claude --contract 2",
      events: [{ name: "SessionStart" }, { name: "UserPromptSubmit" }, { name: "Stop" }],
      via: "cli",
    });
  });

  it("runs the host launcher, quoted as one shell word, only when it is this CLI's launcher", async () => {
    const launcherPath = await hostLauncher();
    const quoted = `'${launcherPath.replaceAll("'", `'"'"'`)}'`;
    expect(await plan(await folder({}), { launcher: launcherPath })).toMatchObject({
      command: `node ${quoted} --provider claude --contract 2`,
      via: "launcher",
    });
    const tampered = await hostLauncher("process.exit(0);\n");
    expect((await plan(await folder({}), { launcher: tampered }))?.via).toBe("cli");
  });

  it("writes the launcher path with forward slashes on Windows", async () => {
    const launcherPath = await hostLauncher();
    const windows = await plan(await folder({}), { launcher: launcherPath, platform: "win32" });
    expect(windows?.command).not.toContain("\\");
  });

  it("records only the planned events the written settings run", () => {
    const hooks = {
      command: "lervo terminal hook --provider claude --contract 2",
      events: [{ name: "SessionStart" as const, matcher: "resume" }, { name: "Stop" as const }],
      via: "cli" as const,
    };
    const written = (entries: object) => ({ content: JSON.stringify({ hooks: entries }) });
    const handler = (matcher?: string) => [
      { ...(matcher === undefined ? {} : { matcher }), hooks: [{ command: hooks.command }] },
    ];
    expect(
      writtenTerminalHooks(hooks, written({ SessionStart: handler("resume"), Stop: handler() })),
    ).toEqual({ events: ["SessionStart", "Stop"], via: "cli" });
    expect(
      writtenTerminalHooks(hooks, written({ SessionStart: handler(), Stop: handler() })),
    ).toEqual({ events: ["Stop"], via: "cli" });
    expect(writtenTerminalHooks(hooks, written({}))).toBeUndefined();
    expect(writtenTerminalHooks(hooks, null)).toBeUndefined();
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

  it("adds the claim handler for a claiming conversation, unless the worktree's settings run it", async () => {
    const tools = "Edit|Write|MultiEdit|NotebookEdit|Bash";
    const hooked = settings(
      ["SessionStart", "UserPromptSubmit", "Stop"],
      "lervo terminal hook --provider claude --contract 2",
    );
    expect(await plan(await folder({ ".claude/settings.json": hooked }), { claims: true })).toEqual(
      {
        command: "lervo terminal hook --provider claude --contract 2",
        events: [{ name: "PreToolUse", matcher: tools }],
        via: "cli",
        claimCommand: "lervo terminal hook --provider claude --contract 2 --claim",
      },
    );
    const local = JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: tools,
            hooks: [
              {
                type: "command",
                command: "node '/h/launcher.mjs' --provider claude --contract 2 --claim",
                timeout: 60,
              },
            ],
          },
        ],
      },
    });
    const claiming = await folder({
      ".claude/settings.json": hooked,
      ".claude/settings.local.json": local,
    });
    expect(await plan(claiming, { claims: true })).toBeUndefined();
    expect(await plan(await folder({ ".claude/settings.json": hooked }))).toBeUndefined();
    const planned = await plan(await folder({}), { claims: true });
    if (planned === undefined) throw new Error("no plan");
    const written = claudeSessionSettings("lervo hosted-hook", planned);
    expect(writtenTerminalHooks(planned, { content: written })).toEqual({
      events: ["SessionStart", "UserPromptSubmit", "Stop", "PreToolUse"],
      via: "cli",
    });
  });

  it("adds nothing for a provider that takes no hooks", async () => {
    expect(
      await hostedTerminalHooks(createCodexHostedSessionAdapter("/opt/codex"), await folder({})),
    ).toBeUndefined();
  });
});
