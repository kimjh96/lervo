import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { collectChangedRepositoryPaths } from "./changed-runtime-verification/git-changes.mjs";
import { createChangedRuntimeVerificationPlan } from "./changed-runtime-verification/verification-plan.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const changedPaths = await collectChangedRepositoryPaths(repositoryRoot);
const plan = createChangedRuntimeVerificationPlan(changedPaths);
const displayedTriggers = plan.escalationTriggers.slice(0, 32);

process.stdout.write(
  `${JSON.stringify({
    schemaVersion: 1,
    mode: plan.mode,
    changedPathCount: plan.changedPathCount,
    escalationTriggers: displayedTriggers,
    omittedTriggerCount: plan.escalationTriggers.length - displayedTriggers.length,
  })}\n`,
);

const exitCode = await new Promise((resolveExit, reject) => {
  const child = spawn(plan.executable, plan.arguments, {
    cwd: repositoryRoot,
    env: { ...process.env, CI: "1" },
    stdio: "inherit",
  });
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (code !== null) resolveExit(code);
    else reject(new Error(`Runtime verification was terminated by signal ${signal ?? "unknown"}.`));
  });
});

process.exitCode = exitCode;
