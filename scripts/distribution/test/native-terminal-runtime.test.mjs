import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { importBuiltWorkspacePackage, repositoryRoot } from "../lib/installed-cli.mjs";
import { smokeNativeCas } from "../../shared/native-cas-smoke.mjs";
import { smokeNativeFileSync } from "../../shared/native-file-sync-smoke.mjs";

const executeFile = promisify(execFile);

function hook(entry, provider, root, env, event = "Stop") {
  return new Promise((done, reject) => {
    const child = execFile(
      process.execPath,
      [entry, "--provider", provider, "--contract", "2"],
      { cwd: root, env, maxBuffer: 1024 * 1024, timeout: 15000 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") reject(error);
        else done({ code: error?.code ?? 0, stdout, stderr });
      },
    );
    child.stdin.end(
      JSON.stringify({
        hook_event_name: event,
        prompt: "Inspect the current repository.",
        session_id: "native-runtime-fixture",
        cwd: root,
        stop_hook_active: true,
      }),
    );
  });
}
it("installs the launcher and host native bytes, runs both providers from a subdirectory, and rejects native tampering", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-installed-native-hook-"));
  try {
    const project = await importBuiltWorkspacePackage("project"),
      knowledge = await importBuiltWorkspacePackage("repository-knowledge");
    await project.applyInitPlan(
      await project.createInitPlan({
        root,
        projectId: "prj_native_hook_fixture",
        now: new Date("2026-10-10T00:00:00Z"),
      }),
    );
    const environment = {
      ...process.env,
      NODE_ENV: "production",
      LERVO_TERMINAL_CONTEXT: "compact",
      HOME: resolve(root, "home"),
      USERPROFILE: resolve(root, "home"),
      LOCALAPPDATA: resolve(root, "local"),
    };
    const store = knowledge.terminalHookRuntimeStorePath(
      environment,
      process.platform,
      resolve(root, "home"),
    );
    const fullRuntime = await readFile(
      resolve(repositoryRoot, "apps/cli/dist/terminal-hook.js"),
      "utf8",
    );
    const runtimeContent = await readFile(
      resolve(repositoryRoot, "apps/cli/dist/terminal-hook-launcher.mjs"),
      "utf8",
    );
    expect(runtimeContent).toBe(
      await readFile(resolve(repositoryRoot, "apps/cli/src/terminal-hook-launcher.mjs"), "utf8"),
    );
    expect(Buffer.byteLength(runtimeContent)).toBeLessThanOrEqual(16 * 1024);
    const runtimeAssets =
      process.platform === "darwin"
        ? await knowledge.loadTerminalHookNativeAssets(resolve(repositoryRoot, "apps/cli/dist"))
        : [];
    await knowledge.materializeHostTerminalRuntime({
      store,
      runtimeContent: fullRuntime,
      assets: runtimeAssets,
    });
    const pointer = JSON.parse(await readFile(resolve(store, "current.json"), "utf8"));
    const hostDirectory = resolve(store, pointer.directory);
    const plan = await knowledge.createTerminalIntegrationPlan(root, runtimeContent, null);
    await knowledge.applyTerminalIntegrationPlan({
      plan,
      runtimeContent,
      approvedOperationId: plan.operationId,
      approvedHash: plan.approvalHash,
      now: new Date(),
      recordApplied: () => undefined,
    });
    const directory = resolve(root, ".lervo/generated/terminal-hooks"),
      entry = resolve(directory, "runtime-v2.mjs");
    expect(await knowledge.verifyTerminalHookRuntimeArtifact(entry)).toBe(true);
    if (process.platform === "darwin") {
      expect(await smokeNativeFileSync(resolve(hostDirectory, "native"))).toBe("native");
      expect(await smokeNativeCas(resolve(hostDirectory, "native"))).toBe("native");
    }
    if (process.platform === "darwin") expect(runtimeAssets).toHaveLength(4);
    await expect(readFile(resolve(directory, "native/cas-io-darwin.node"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    const child = resolve(root, "nested");
    await mkdir(child);
    for (const provider of ["codex", "claude"])
      expect(await hook(entry, provider, child, environment)).toMatchObject({
        code: 0,
        stdout: "{}\n",
      });
    await executeFile("git", ["init", "--quiet"], { cwd: root });
    const cli = resolve(repositoryRoot, "apps/cli/dist/bin.js");
    const run = (args) =>
      executeFile(process.execPath, [cli, ...args], { cwd: root, env: environment });
    const evidence = await run(["event-contract", "evidence", "--json"]);
    const evidencePath = resolve(root, "reader-evidence.json");
    await writeFile(evidencePath, evidence.stdout);
    const activation = JSON.parse(
      (
        await run([
          "event-contract",
          "activate",
          "--from",
          evidencePath,
          "--schema-version",
          "4",
          "--json",
        ])
      ).stdout,
    );
    await run([
      "event-contract",
      "activate",
      "--from",
      evidencePath,
      "--schema-version",
      "4",
      "--apply",
      activation.planId,
      "--json",
    ]);
    for (const provider of ["codex", "claude"]) {
      const result = await hook(entry, provider, child, environment, "UserPromptSubmit");
      expect(result.code).toBe(0);
      expect(JSON.parse(result.stdout).hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
    }
    const binary = runtimeAssets.length
        ? resolve(hostDirectory, "native/cas-io-darwin.node")
        : resolve(hostDirectory, "runtime-v2.mjs"),
      bytes = await readFile(binary);
    bytes[bytes.length - 1] ^= 1;
    await writeFile(binary, bytes);
    for (const provider of ["codex", "claude"])
      expect(await hook(entry, provider, child, environment)).toMatchObject({
        code: 2,
        stderr: "Lervo terminal hook runtime integrity verification failed.\n",
      });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

it("an installed CLI upgrade changes only host runtime bytes across three checkout fixtures", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-hook-upgrade-"));
  const environment = {
    ...process.env,
    NODE_ENV: "production",
    HOME: resolve(root, "home"),
    USERPROFILE: resolve(root, "home"),
    LOCALAPPDATA: resolve(root, "local"),
    LERVO_USER_STATE_DIRECTORY: resolve(root, "state"),
  };
  const execute = (entry, args, cwd) =>
    new Promise((done, reject) => {
      execFile(entry, args, { cwd, env: environment, timeout: 30000 }, (error, stdout, stderr) =>
        error ? reject(error) : done({ stdout, stderr }),
      );
    });
  try {
    const project = await importBuiltWorkspacePackage("project");
    const knowledge = await importBuiltWorkspacePackage("repository-knowledge");
    const launcher = await readFile(
      resolve(repositoryRoot, "apps/cli/dist/terminal-hook-launcher.mjs"),
      "utf8",
    );
    const runtime = await readFile(
      resolve(repositoryRoot, "apps/cli/dist/terminal-hook.js"),
      "utf8",
    );
    const assets =
      process.platform === "darwin"
        ? await knowledge.loadTerminalHookNativeAssets(resolve(repositoryRoot, "apps/cli/dist"))
        : [];
    const store = knowledge.terminalHookRuntimeStorePath(
      environment,
      process.platform,
      resolve(root, "home"),
    );
    await knowledge.materializeHostTerminalRuntime({
      store,
      runtimeContent: `${runtime}\n// previous installed build\n`,
      assets,
    });
    const checkouts = [];
    for (const name of ["lervo", "flemo", "axli"]) {
      const cwd = resolve(root, name);
      await mkdir(cwd);
      await project.applyInitPlan(
        await project.createInitPlan({
          root: cwd,
          projectId: `prj_upgrade_${name}`,
          now: new Date("2026-10-31T00:00:00Z"),
        }),
      );
      const plan = await knowledge.createTerminalIntegrationPlan(cwd, launcher);
      await knowledge.applyTerminalIntegrationPlan({
        plan,
        runtimeContent: launcher,
        approvedOperationId: plan.operationId,
        approvedHash: plan.approvalHash,
        now: new Date(),
        recordApplied: () => undefined,
      });
      await execute("git", ["init", "--quiet"], cwd);
      await execute("git", ["add", "."], cwd);
      checkouts.push({
        cwd,
        status: (await execute("git", ["status", "--porcelain"], cwd)).stdout,
      });
    }
    const sourceEntry = resolve(repositoryRoot, "apps/cli/dist/bin.js");
    const previousPointer = await readFile(resolve(store, "current.json"));
    await execute(process.execPath, [sourceEntry, "--version"], root);
    expect(await readFile(resolve(store, "current.json"))).toEqual(previousPointer);

    // A settled installation has dist but no adjacent src/bin.ts.
    const installed = resolve(root, "settled-fixture/dist");
    await cp(resolve(repositoryRoot, "apps/cli/dist"), installed, { recursive: true });
    await cp(
      resolve(repositoryRoot, "apps/cli/package.json"),
      resolve(installed, "../package.json"),
    );
    await execute(process.execPath, [resolve(installed, "bin.js"), "--version"], root);
    const pointer = JSON.parse(await readFile(resolve(store, "current.json"), "utf8"));
    expect(pointer.contentHash).toBe(knowledge.sha256(runtime));
    for (const checkout of checkouts) {
      expect((await execute("git", ["status", "--porcelain"], checkout.cwd)).stdout).toBe(
        checkout.status,
      );
      expect((await execute("git", ["diff", "--name-only"], checkout.cwd)).stdout).toBe("");
      const prepared = await knowledge.createTerminalIntegrationPlan(checkout.cwd, launcher);
      expect(prepared.status).toBe("current");
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
