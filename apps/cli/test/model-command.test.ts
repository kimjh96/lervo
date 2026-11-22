import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runModelCommand } from "../src/model-command.js";
import type { CliIo } from "../src/types.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function environment(): Promise<NodeJS.ProcessEnv> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-model-command-"));
  roots.push(root);
  return { ...process.env, LERVO_USER_STATE_DIRECTORY: resolve(root, "state") };
}

async function run(env: NodeJS.ProcessEnv, ...args: string[]) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: CliIo = {
    cwd: "/",
    stdout: (message) => stdout.push(message),
    stderr: (message) => stderr.push(message),
  };
  const code = await runModelCommand(args, io, env);
  return { code, stdout: stdout.join(""), stderr: stderr.join("") };
}

describe("lervo model (ADR-0612)", () => {
  it("chooses a role's routes in one command and shows them", async () => {
    const env = await environment();
    expect((await run(env, "show")).stdout).toContain("background: provider defaults (effort low)");
    const set = await run(env, "set", "background", "claude/claude-haiku-5-5@medium", "codex");
    expect(set.code).toBe(0);
    expect(set.stdout).toContain("background: claude/claude-haiku-5-5@medium, then codex");
    expect(set.stdout).toContain("nothing needs a restart");
    const shown = JSON.parse((await run(env, "show", "--json")).stdout);
    expect(shown.selection).toMatchObject({
      revision: 1,
      roles: {
        background: [
          { provider: "claude", model: "claude-haiku-5-5", reasoningEffort: "medium" },
          { provider: "codex", model: null, reasoningEffort: null },
        ],
      },
    });
    expect((await run(env, "unset", "background")).stdout).toContain(
      "background: provider defaults",
    );
  });

  it("refuses an unknown role, provider, effort, or a review route below its floor", async () => {
    const env = await environment();
    for (const args of [
      ["set", "everything", "claude"],
      ["set", "routine", "gemini"],
      ["set", "routine", "claude@extreme"],
      ["set", "review", "claude@low"],
      ["set", "routine"],
      ["set", "routine", "claude", "claude"],
    ]) {
      const result = await run(env, ...args);
      expect(result.code, args.join(" ")).toBe(1);
    }
    expect(JSON.parse((await run(env, "show", "--json")).stdout).selection.revision).toBe(0);
  });
});
