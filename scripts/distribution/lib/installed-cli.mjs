import { execFile } from "node:child_process";
import { spawn } from "node:child_process";
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

// pnpm sets npm_execpath to its own entry point. That is a JavaScript file for an npm-installed
// pnpm but a native executable for the standalone build, which node cannot load.
function pnpmCommand(args) {
  const entry = process.env.npm_execpath;
  return entry && /\.[cm]?js$/.test(entry)
    ? { executable: process.execPath, args: [entry, ...args] }
    : { executable: entry || "pnpm", args };
}

export async function runPnpm(args, options = {}) {
  const commandOptions = {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  };
  const command = pnpmCommand(args);
  return execFileAsync(command.executable, command.args, commandOptions);
}

export async function runPnpmWithInput(args, input, options = {}) {
  const commandOptions = {
    cwd: repositoryRoot,
    env: process.env,
    ...options,
  };
  const command = pnpmCommand(args);
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command.executable, command.args, {
      cwd: commandOptions.cwd,
      env: commandOptions.env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout = [];
    const stderr = [];
    let byteCount = 0;
    const append = (target, chunk) => {
      byteCount += chunk.byteLength;
      if (byteCount > 10 * 1024 * 1024) {
        child.kill();
        rejectPromise(new Error("The pnpm command output exceeded 10 MiB."));
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", (chunk) => append(stdout, chunk));
    child.stderr.on("data", (chunk) => append(stderr, chunk));
    child.once("error", rejectPromise);
    child.once("close", (code) => {
      const result = {
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      };
      if (code === 0) resolvePromise(result);
      else {
        const error = new Error(`The pnpm command exited with code ${String(code)}.`);
        Object.assign(error, result);
        rejectPromise(error);
      }
    });
    child.stdin.end(input);
  });
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
