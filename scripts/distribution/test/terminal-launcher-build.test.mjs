import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { buildTerminalRuntime } from "../../../apps/cli/scripts/build-terminal-runtime.mjs";
import { repositoryRoot } from "../lib/installed-cli.mjs";

it("produces byte-identical launchers on repeated builds of the launcher contract", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-launcher-build-"));
  try {
    const outputs = [resolve(root, "first"), resolve(root, "second")];
    for (const outputDirectory of outputs) {
      await mkdir(outputDirectory);
      await buildTerminalRuntime({
        repositoryRoot,
        cliRoot: resolve(repositoryRoot, "apps/cli"),
        outputDirectory,
      });
    }
    const first = await readFile(resolve(outputs[0], "terminal-hook-launcher.mjs"));
    expect(await readFile(resolve(outputs[1], "terminal-hook-launcher.mjs"))).toEqual(first);
    expect(first.length).toBeLessThanOrEqual(16 * 1024);
    const cli = JSON.parse(
      await readFile(resolve(repositoryRoot, "apps/cli/package.json"), "utf8"),
    );
    expect(first.toString()).not.toContain(cli.version);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
