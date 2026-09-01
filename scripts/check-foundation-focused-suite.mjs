import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { foundationFocusedSuites } from "./foundation-readiness/check-bindings.mjs";

const args = process.argv.slice(2);
if (args[0] === "--") args.shift();
const parsed = parseArgs({ args, strict: true, options: { area: { type: "string" } } });
const paths = foundationFocusedSuites[parsed.values.area];
if (paths === undefined) throw new TypeError("The foundation focused-suite area is invalid.");
const repositoryRoot = resolve(import.meta.dirname, "..");
const child = spawn("pnpm", ["exec", "vitest", "run", ...paths], {
  cwd: repositoryRoot,
  env: { ...process.env, CI: "1" },
  stdio: "inherit",
});
const exitCode = await new Promise((resolvePromise, rejectPromise) => {
  child.once("error", rejectPromise);
  child.once("close", (code) => resolvePromise(code ?? 1));
});
if (exitCode !== 0) process.exitCode = exitCode;
