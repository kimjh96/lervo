import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

import { withExcludeBlock, writeClaimHandler } from "../src/claim-handler-settings.js";

const run = promisify(execFile);
const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
async function repository(): Promise<string> {
  const made = await mkdtemp(join(tmpdir(), "lervo-claim-handler-"));
  folders.push(made);
  await run("git", ["init", "-q", made]);
  return made;
}
const git = async (root: string, ...arguments_: string[]) =>
  (await run("git", ["-C", root, ...arguments_])).stdout;
// No trusted launcher, so the handler runs the CLI's terminal hook.
const options = { launcher: "/nonexistent/launcher.mjs" };

describe("writing the claim handler into a conversation's worktree", () => {
  it("writes the handler and the exclude block once, and the file never shows as a change", async () => {
    const root = await repository();
    expect(await writeClaimHandler(root, "claude", options)).toEqual({ status: "written" });
    const settings = JSON.parse(await readFile(join(root, ".claude/settings.local.json"), "utf8"));
    expect(settings.hooks.PreToolUse).toEqual([
      {
        matcher: "Edit|Write|MultiEdit|NotebookEdit|Bash",
        hooks: [
          {
            type: "command",
            command: "lervo terminal hook --provider claude --contract 2 --claim",
            timeout: 10,
          },
        ],
      },
    ]);
    expect(await git(root, "status", "--porcelain")).toBe("");
    expect(await writeClaimHandler(root, "claude", options)).toEqual({ status: "unchanged" });
    const exclude = await readFile(join(root, ".git/info/exclude"), "utf8");
    expect(exclude.match(/lervo:begin claim-handler/gu)).toHaveLength(1);
  });

  it("leaves a tracked settings file and a provider that claims nothing", async () => {
    const root = await repository();
    await mkdir(join(root, ".claude"));
    await writeFile(join(root, ".claude/settings.local.json"), "{}\n");
    await git(root, "add", "-f", ".claude/settings.local.json");
    expect(await writeClaimHandler(root, "claude", options)).toEqual({
      status: "skipped",
      code: "settings_tracked",
    });
    expect(await readFile(join(root, ".claude/settings.local.json"), "utf8")).toBe("{}\n");
    expect(await writeClaimHandler(root, "codex", options)).toEqual({
      status: "skipped",
      code: "provider_claims_nothing",
    });
  });

  it("keeps the user's exclude lines around its block", () => {
    const before = "# git ls-files --others --exclude-from=.git/info/exclude\n*.log";
    const once = withExcludeBlock(before, "/.claude/settings.local.json");
    expect(once).toBe(
      `${before}\n# lervo:begin claim-handler schema=1\n/.claude/settings.local.json\n# lervo:end claim-handler\n`,
    );
    expect(withExcludeBlock(`${once}build/\n`, "/.claude/settings.local.json")).toBe(
      `${once}build/\n`,
    );
  });
});
