import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { collectChangedRepositoryPaths } from "./changed-verification/git-changes.mjs";
import { staticCheckUnaffected } from "./changed-verification/static-verification-plan.mjs";

const check = process.argv.length === 3 ? process.argv[2] : null;
if (check !== "lint" && check !== "typecheck")
  throw new Error("Pass exactly one static check: lint or typecheck.");

const repositoryRoot = resolve(import.meta.dirname, "../..");
const changedPaths = await collectChangedRepositoryPaths(repositoryRoot);
const unaffected = staticCheckUnaffected(changedPaths);
process.stdout.write(
  `${JSON.stringify({
    schemaVersion: 1,
    check,
    mode: unaffected ? "unaffected" : "full",
    changedPathCount: changedPaths.length,
  })}\n`,
);

if (!unaffected) {
  const exitCode = await new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, ["--run", check], {
      cwd: repositoryRoot,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code !== null) resolveExit(code);
      else reject(new Error(`The ${check} check was terminated by signal ${signal ?? "unknown"}.`));
    });
  });
  process.exitCode = exitCode;
}
