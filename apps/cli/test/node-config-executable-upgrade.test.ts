import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  currentCliExecutable,
  currentCliInstallRoot,
  pointCurrentCliInstall,
  readCurrentCliInstall,
  runningCliInstallRoot,
} from "../src/cli-install-pointer.js";
import {
  inspectNodeConfigExecutables,
  nodeConfigExecutablesPending,
  prepareNodeConfigExecutables,
} from "../src/node-config-executable-upgrade.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function installCli(home: string, label: string): Promise<string> {
  const root = resolve(home, ".local", "lib", "lervo-cli", label, "node_modules", "@lervo", "cli");
  await mkdir(resolve(root, "dist"), { recursive: true });
  await writeFile(resolve(root, "dist", "bin.js"), `#!/usr/bin/env node\n// ${label}\n`, {
    mode: 0o755,
  });
  await chmod(resolve(root, "dist", "bin.js"), 0o755);
  return root;
}

async function fixture() {
  const home = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-node-config-executables-")));
  directories.push(home);
  const running = await installCli(home, "open-collab-0.20.0");
  // The incident: Node configurations pinned an install that cleanup later removed.
  const removed = resolve(
    home,
    ".local/lib/lervo-cli/convergence-0.18.0/node_modules/@lervo/cli/dist/bin.js",
  );
  const config = resolve(home, "node-runtime.json");
  const original = `${JSON.stringify(
    {
      schemaVersion: 1,
      discordConversation: { deliberation: { cliExecutable: removed } },
      outcomeSupervision: {
        managedExecution: { nodeExecutable: "/usr/bin/node", cliBundle: removed },
      },
    },
    null,
    2,
  )}\n`;
  await writeFile(config, original, { mode: 0o600 });
  const options = {
    homeDirectory: home,
    cliBin: pathToFileURL(resolve(running, "dist", "bin.js")),
  };
  return { home, running, removed, config, original, options };
}

describe("CLI install pointer (ADR-0488)", () => {
  it("creates, keeps, and swaps the pointer only to an install with dist/bin.js", async () => {
    const home = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-cli-pointer-")));
    directories.push(home);
    const first = await installCli(home, "first");
    const second = await installCli(home, "second");

    expect(await readCurrentCliInstall(home)).toBeNull();
    expect(await pointCurrentCliInstall({ installRoot: first, homeDirectory: home })).toBe(
      "created",
    );
    expect(await pointCurrentCliInstall({ installRoot: first, homeDirectory: home })).toBe(
      "unchanged",
    );
    expect(await pointCurrentCliInstall({ installRoot: second, homeDirectory: home })).toBe(
      "updated",
    );
    expect(await readlink(currentCliInstallRoot(home))).toBe(second);
    expect(await readFile(currentCliExecutable(home), "utf8")).toContain("// second");
    await expect(
      pointCurrentCliInstall({ installRoot: resolve(home, "missing"), homeDirectory: home }),
    ).rejects.toThrow("no regular dist/bin.js");
    expect(await readCurrentCliInstall(home)).toBe(second);
    // The swap leaves no temporary link behind.
    expect(await readdir(resolve(currentCliInstallRoot(home), ".."))).toEqual(["current"]);
  });

  it("resolves the running install only from a built dist/bin.js", async () => {
    const home = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-cli-running-")));
    directories.push(home);
    const root = await installCli(home, "running");
    expect(await runningCliInstallRoot(pathToFileURL(resolve(root, "dist", "bin.js")))).toBe(root);
    expect(await runningCliInstallRoot(pathToFileURL(resolve(home, "src", "bin.js")))).toBeNull();
  });
});

describe("Node configuration executable upgrade (ADR-0488)", () => {
  it("plans with field names, points the CLI, and prepares the migration without writing the config", async () => {
    const { home, running, removed, config, original, options } = await fixture();

    const inspection = await inspectNodeConfigExecutables(config, options);
    expect(inspection.stage).toMatchObject({
      cliPointer: "create",
      config: "migrate",
      rewrittenFields: [
        "discordConversation.deliberation.cliExecutable",
        "outcomeSupervision.managedExecution.cliBundle",
      ],
      overrideFields: [],
    });
    expect(JSON.stringify(inspection.stage)).not.toContain(home);
    expect(nodeConfigExecutablesPending(inspection.stage)).toBe(true);

    const prepared = await prepareNodeConfigExecutables(config, inspection.stage, options);

    expect(await readCurrentCliInstall(home)).toBe(running);
    // ADR-0489: a running Node binds its admission to these bytes, so they stay untouched.
    expect(await readFile(config, "utf8")).toBe(original);
    const migrated = JSON.parse(await readFile(prepared.configurationSource!, "utf8"));
    expect(migrated.discordConversation.deliberation.cliExecutable).toBe(
      currentCliExecutable(home),
    );
    expect(migrated.outcomeSupervision.managedExecution).toEqual({
      nodeExecutable: "/usr/bin/node",
      cliBundle: currentCliExecutable(home),
    });
    expect((await stat(prepared.configurationSource!)).mode & 0o777).toBe(0o600);
    expect(prepared.backupPath).toMatch(/node-runtime\.json\.pre-adr-0488-[a-f0-9]{12}$/u);
    expect(await readFile(prepared.backupPath!, "utf8")).toBe(original);
    expect((await stat(prepared.backupPath!)).mode & 0o777).toBe(0o600);
    expect(original).toContain(removed);

    // The guarded service transition replaces the file; then the stage is current.
    await writeFile(config, await readFile(prepared.configurationSource!), { mode: 0o600 });
    await prepared.cleanup();
    await expect(stat(prepared.configurationSource!)).rejects.toMatchObject({ code: "ENOENT" });
    const again = await inspectNodeConfigExecutables(config, options);
    expect(again.stage).toMatchObject({ cliPointer: "current", config: "current" });
    expect(nodeConfigExecutablesPending(again.stage)).toBe(false);

    // A later CLI install moves only the pointer; nothing replaces the configuration.
    const next = await installCli(home, "open-collab-0.21.0");
    const nextOptions = { ...options, cliBin: pathToFileURL(resolve(next, "dist", "bin.js")) };
    const moved = await inspectNodeConfigExecutables(config, nextOptions);
    expect(moved.stage).toMatchObject({ cliPointer: "update", config: "current" });
    const pointerOnly = await prepareNodeConfigExecutables(config, moved.stage, nextOptions);
    expect(pointerOnly.configurationSource).toBeNull();
    expect(await readFile(currentCliExecutable(home), "utf8")).toContain("open-collab-0.21.0");
  });

  it("refuses a configuration that changed after the plan", async () => {
    const { config, options } = await fixture();
    const inspection = await inspectNodeConfigExecutables(config, options);
    await writeFile(config, `${JSON.stringify({ schemaVersion: 1 })}\n`);

    await expect(
      prepareNodeConfigExecutables(config, inspection.stage, options),
    ).rejects.toMatchObject({ code: "node_config_executables_plan_stale" });
  });

  it("plans nothing when the running CLI is not an installed build", async () => {
    const { home, config, original } = await fixture();
    const inspection = await inspectNodeConfigExecutables(config, {
      homeDirectory: home,
      cliBin: pathToFileURL(resolve(home, "source", "bin.js")),
    });
    expect(inspection.stage).toMatchObject({
      cliPointer: "not_installed",
      config: "current",
      rewrittenFields: [],
    });
    expect(nodeConfigExecutablesPending(inspection.stage)).toBe(false);
    expect(await readFile(config, "utf8")).toBe(original);
  });
});
