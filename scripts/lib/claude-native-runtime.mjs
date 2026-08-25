import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { collectInstalledPackages } from "./release-dependency-closure.mjs";
import { readJson } from "./installed-cli.mjs";

const execFileAsync = promisify(execFile);
const nativePackagePrefix = "@anthropic-ai/claude-agent-sdk-";
const nativePackageVersion = "0.3.226";

export function claudeNativePackageName({ platform, arch, musl = false }) {
  if (platform === "darwin" && (arch === "arm64" || arch === "x64")) {
    return `${nativePackagePrefix}darwin-${arch}`;
  }
  if (platform === "linux" && (arch === "arm64" || arch === "x64")) {
    return `${nativePackagePrefix}linux-${arch}${musl ? "-musl" : ""}`;
  }
  if (platform === "win32" && (arch === "arm64" || arch === "x64")) {
    return `${nativePackagePrefix}win32-${arch}`;
  }
  return null;
}

function currentRuntimeUsesMusl() {
  if (process.platform !== "linux") return false;
  const report = process.report?.getReport();
  return report?.header?.glibcVersionRuntime === undefined;
}

export async function verifyInstalledClaudeNativeRuntime(consumerRoot) {
  const packageName = claudeNativePackageName({
    platform: process.platform,
    arch: process.arch,
    musl: currentRuntimeUsesMusl(),
  });
  assert.notEqual(packageName, null, "The platform must be supported by the release matrix.");

  const cliEntry = resolve(consumerRoot, "node_modules/@lervo/cli/dist/bin.js");
  const sdkEntry = createRequire(await realpath(cliEntry)).resolve(
    "@anthropic-ai/claude-agent-sdk",
  );
  const nativeManifestPath = createRequire(sdkEntry).resolve(`${packageName}/package.json`);
  const nativeManifest = await readJson(nativeManifestPath);
  assert.equal(nativeManifest.name, packageName);
  assert.equal(nativeManifest.version, nativePackageVersion);
  assert.deepEqual(nativeManifest.os, [process.platform]);
  assert.deepEqual(nativeManifest.cpu, [process.arch]);

  const installedPackages = await collectInstalledPackages(resolve(consumerRoot, "node_modules"));
  assert.deepEqual(
    [...installedPackages.keys()]
      .filter((coordinate) => coordinate.startsWith(nativePackagePrefix))
      .sort(),
    [`${packageName}@${nativePackageVersion}`],
  );

  const executable = resolve(
    dirname(nativeManifestPath),
    process.platform === "win32" ? "claude.exe" : "claude",
  );
  await access(executable, process.platform === "win32" ? constants.F_OK : constants.X_OK);
  const { stdout, stderr } = await execFileAsync(executable, ["--version"], {
    encoding: "utf8",
    env: process.env.PATH === undefined ? {} : { PATH: process.env.PATH },
    maxBuffer: 16 * 1024,
    timeout: 5_000,
    windowsHide: true,
  });
  const version = `${stdout}${stderr}`
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);
  assert.match(version ?? "", /^\d+\.\d+\.\d+ \(Claude Code\)$/u);
  return { packageName, version };
}
