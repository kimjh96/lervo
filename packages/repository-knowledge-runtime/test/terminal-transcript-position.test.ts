import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { openProviderTranscript } from "../src/terminal-transcript-position.js";

const roots: string[] = [];
const previous = process.env.CLAUDE_CONFIG_DIR;

afterEach(async () => {
  if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = previous;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function transcriptIn(configuration: string): Promise<string> {
  const directory = join(configuration, "projects", "-work-repo");
  await mkdir(directory, { recursive: true });
  const path = join(directory, "session.jsonl");
  await writeFile(path, '{"type":"user"}\n');
  return path;
}

describe("a provider's transcript", () => {
  it("opens from the Claude Code directory CLAUDE_CONFIG_DIR names", async () => {
    const configuration = await realpath(await mkdtemp(join(tmpdir(), "lervo-claude-config-")));
    roots.push(configuration);
    process.env.CLAUDE_CONFIG_DIR = configuration;
    const handle = await openProviderTranscript("claude", await transcriptIn(configuration));
    expect((await handle.readFile("utf8")).startsWith('{"type":"user"}')).toBe(true);
    await handle.close();
  });

  it("still refuses a transcript outside the provider's directory", async () => {
    const configuration = await realpath(await mkdtemp(join(tmpdir(), "lervo-claude-config-")));
    const elsewhere = await realpath(await mkdtemp(join(tmpdir(), "lervo-elsewhere-")));
    roots.push(configuration, elsewhere);
    await mkdir(join(configuration, "projects"), { recursive: true });
    process.env.CLAUDE_CONFIG_DIR = configuration;
    await expect(openProviderTranscript("claude", await transcriptIn(elsewhere))).rejects.toThrow(
      "Transcript escaped its provider directory.",
    );
  });
});
