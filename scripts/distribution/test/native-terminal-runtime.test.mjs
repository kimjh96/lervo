import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { importBuiltWorkspacePackage, repositoryRoot } from "../lib/installed-cli.mjs";
import { smokeNativeCas } from "../../shared/native-cas-smoke.mjs";
import { smokeNativeFileSync } from "../../shared/native-file-sync-smoke.mjs";

function hook(entry, provider, root) {
  return new Promise((done, reject) => {
    const child = execFile(
      process.execPath,
      [entry, "--provider", provider, "--contract", "2"],
      { cwd: root, maxBuffer: 1024 * 1024, timeout: 15000 },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") reject(error);
        else done({ code: error?.code ?? 0, stdout, stderr });
      },
    );
    child.stdin.end(
      JSON.stringify({
        hook_event_name: "Stop",
        session_id: "native-runtime-fixture",
        cwd: root,
        stop_hook_active: true,
      }),
    );
  });
}
it("installs the real hook and native bytes, runs both provider entries, and rejects native tampering", async () => {
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
    const runtimeContent = await readFile(
      resolve(repositoryRoot, "apps/cli/dist/terminal-hook.js"),
      "utf8",
    );
    const runtimeAssets = await knowledge.loadTerminalHookNativeAssets(
      resolve(repositoryRoot, "apps/cli/dist"),
    );
    const plan = await knowledge.createTerminalIntegrationPlan(
      root,
      runtimeContent,
      null,
      runtimeAssets,
    );
    await knowledge.applyTerminalIntegrationPlan({
      plan,
      runtimeContent,
      runtimeAssets,
      approvedOperationId: plan.operationId,
      approvedHash: plan.approvalHash,
      now: new Date(),
      recordApplied: () => undefined,
    });
    const directory = resolve(root, ".lervo/generated/terminal-hooks"),
      entry = resolve(directory, "runtime-v2.mjs");
    expect(await knowledge.verifyTerminalHookRuntimeArtifact(entry)).toBe(true);
    if (process.platform === "darwin") {
      expect(await smokeNativeFileSync(resolve(directory, "native"))).toBe("native");
      expect(await smokeNativeCas(resolve(directory, "native"))).toBe("native");
    }
    expect(runtimeAssets).toHaveLength(4);
    const child = resolve(root, "nested");
    await mkdir(child);
    for (const provider of ["codex", "claude"])
      expect(await hook(entry, provider, child)).toMatchObject({ code: 0, stdout: "{}\n" });
    const binary = resolve(directory, "native/cas-io-darwin.node"),
      bytes = await readFile(binary);
    bytes[bytes.length - 1] ^= 1;
    await writeFile(binary, bytes);
    for (const provider of ["codex", "claude"])
      expect(await hook(entry, provider, child)).toMatchObject({
        code: 2,
        stderr: "Lervo terminal hook runtime integrity verification failed.\n",
      });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
