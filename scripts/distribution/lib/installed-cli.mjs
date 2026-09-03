import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { readJson } from "../../shared/read-json.mjs";

export { readJson };

const execFileAsync = promisify(execFile);

export const repositoryRoot = resolve(import.meta.dirname, "../../..");
const pnpmWorkspaceStatePath = resolve(
  repositoryRoot,
  "node_modules/.pnpm-workspace-state-v1.json",
);

export async function runInstalledCli(cliEntry, args, cwd) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [cliEntry, ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  return { stdout, stderr };
}

export async function runPnpm(args, options = {}) {
  const commandOptions = {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  };
  if (process.env.npm_execpath) {
    return execFileAsync(process.execPath, [process.env.npm_execpath, ...args], commandOptions);
  }
  return execFileAsync("pnpm", args, commandOptions);
}

export function pnpmDeployFetchArgs(platform = process.platform) {
  return platform === "win32" ? ["--prefer-offline"] : ["--offline"];
}

async function readOptionalWorkspaceState() {
  try {
    return await readFile(pnpmWorkspaceStatePath);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  }
}

export async function runPnpmDeploy(args, options = {}) {
  const workspaceState = await readOptionalWorkspaceState();
  try {
    return await runPnpm(args, options);
  } finally {
    if (workspaceState === null) await rm(pnpmWorkspaceStatePath, { force: true });
    else await writeFile(pnpmWorkspaceStatePath, workspaceState);
  }
}

export async function deployBuiltCli(target) {
  await runPnpmDeploy([
    ...pnpmDeployFetchArgs(),
    "--config.inject-workspace-packages=true",
    "--config.package-import-method=copy",
    "--filter",
    "@lervo/cli",
    "deploy",
    "--prod",
    target,
  ]);
}

export async function importBuiltWorkspacePackage(packageName) {
  return import(
    pathToFileURL(resolve(repositoryRoot, `packages/${packageName}/dist/index.js`)).href
  );
}
