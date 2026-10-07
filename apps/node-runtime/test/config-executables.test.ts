import { chmod, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertNodeStartupExecutables,
  inspectNodeConfiguredExecutables,
  listNodeConfiguredExecutables,
  type NodeRuntimeConfig,
} from "../src/index.js";
import { removeTemporaryRoots, temporaryRoot } from "./fixture.js";

afterEach(removeTemporaryRoots);

function configuration(root: string): NodeRuntimeConfig {
  const conversation = (cliExecutable: string) => ({
    deliberation: { cliExecutable },
    requestedRuntimes: [{ executable: `${root}/tools/preview` }],
  });
  return {
    discordConversations: [
      conversation(`${root}/cli/current/dist/bin.js`),
      conversation(`${root}/old/node_modules/@lervo/cli/dist/bin.js`),
    ],
    outcomeSupervision: {
      managedExecution: {
        nodeExecutable: `${root}/tools/node`,
        cliBundle: `${root}/cli/current/dist/bin.js`,
      },
      runtimeReadiness: {
        providerExecutables: { codex: `${root}/tools/codex` },
        verificationTools: { "repo.check": [{ toolId: "pnpm", executable: "pnpm" }] },
      },
    },
    remoteCommands: { providerHost: { executables: { claude: `${root}/tools/claude` } } },
  } as unknown as NodeRuntimeConfig;
}

async function executable(path: string, mode = 0o700): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, "#!/bin/sh\n", { mode });
  await chmod(path, mode);
}

describe("Node configured executables (ADR-0488)", () => {
  it("names every absolute executable field and skips PATH-resolved names", async () => {
    const root = await temporaryRoot();
    expect(
      listNodeConfiguredExecutables(configuration(root)).map(
        (entry) => `${entry.field}:${entry.kind}:${entry.access}:${entry.requiredAtStartup}`,
      ),
    ).toEqual([
      "discordConversations[0].deliberation.cliExecutable:lervo_cli:execute:true",
      "discordConversations[0].requestedRuntimes[0].executable:requested_runtime:execute:false",
      "discordConversations[1].deliberation.cliExecutable:lervo_cli:execute:true",
      "discordConversations[1].requestedRuntimes[0].executable:requested_runtime:execute:false",
      "outcomeSupervision.managedExecution.nodeExecutable:node:execute:false",
      "outcomeSupervision.managedExecution.cliBundle:lervo_cli:read:false",
      "outcomeSupervision.runtimeReadiness.providerExecutables.codex:provider:execute:false",
      "remoteCommands.providerHost.executables.claude:provider:execute:false",
    ]);
  });

  it("follows the CLI pointer and reports missing, non-file, and unusable paths", async () => {
    const root = await temporaryRoot();
    const install = resolve(root, "installs", "cli-0.21.0");
    await executable(resolve(install, "dist", "bin.js"));
    await mkdir(resolve(root, "cli"));
    await symlink(install, resolve(root, "cli", "current"));
    await executable(resolve(root, "tools", "node"));
    await executable(resolve(root, "tools", "codex"), 0o600);
    await mkdir(resolve(root, "tools", "claude"));
    await executable(resolve(root, "tools", "preview"));

    const problems = await inspectNodeConfiguredExecutables(
      listNodeConfiguredExecutables(configuration(root)),
    );
    expect(problems.map((item) => `${item.field}:${item.problem}`)).toEqual([
      "discordConversations[1].deliberation.cliExecutable:missing",
      "outcomeSupervision.runtimeReadiness.providerExecutables.codex:not_permitted",
      "remoteCommands.providerHost.executables.claude:not_file",
    ]);
  });

  it("refuses startup by naming the field and path of a removed CLI install", async () => {
    const root = await temporaryRoot();
    const install = resolve(root, "installs", "cli-0.21.0");
    await executable(resolve(install, "dist", "bin.js"));
    await mkdir(resolve(root, "cli"));
    await symlink(install, resolve(root, "cli", "current"));
    const pinned = `${root}/old/node_modules/@lervo/cli/dist/bin.js`;

    await expect(assertNodeStartupExecutables(configuration(root))).rejects.toMatchObject({
      code: "configured_executable_unavailable",
      message: `The executable configured at discordConversations[1].deliberation.cliExecutable does not exist: ${pinned}. Run \`lervo upgrade\` to point it at the installed CLI.`,
    });

    await executable(pinned);
    await expect(assertNodeStartupExecutables(configuration(root))).resolves.toBeUndefined();
    // Only startup-required fields refuse startup; a missing provider is reported, not fatal.
    await rm(resolve(install, "dist", "bin.js"));
    await expect(assertNodeStartupExecutables(configuration(root))).rejects.toMatchObject({
      message: expect.stringContaining("discordConversations[0].deliberation.cliExecutable"),
    });
  });
});
