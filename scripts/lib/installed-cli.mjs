import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const repositoryRoot = resolve(import.meta.dirname, "../..");

export async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

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

export async function deployBuiltCli(target) {
  await runPnpm([
    "--offline",
    "--config.inject-workspace-packages=true",
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
