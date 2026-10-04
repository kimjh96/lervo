import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { collectChangedRepositoryPaths } from "./changed-verification/git-changes.mjs";
import { createChangedRuntimeVerificationPlanV7 } from "./changed-verification/verification-plan-v7.mjs";

const shard = process.argv.length === 3 ? /^([1-4])\/4$/u.exec(process.argv[2]) : null;
if (shard === null) {
  throw new Error("Pass exactly one runtime verification shard: 1/4, 2/4, 3/4, or 4/4.");
}

const repositoryRoot = resolve(import.meta.dirname, "../..");
const changedPaths = await collectChangedRepositoryPaths(repositoryRoot);
const plan = createChangedRuntimeVerificationPlanV7(changedPaths, Number(shard[1]));
const displayedTriggers = plan.escalationTriggers.slice(0, 32);

process.stdout.write(
  `${JSON.stringify({
    schemaVersion: 1,
    mode: plan.mode,
    changedPathCount: plan.changedPathCount,
    escalationTriggers: displayedTriggers,
    omittedTriggerCount: plan.escalationTriggers.length - displayedTriggers.length,
    maximumWorkers: 4,
    shardIndex: plan.shardIndex,
    shardCount: plan.shardCount,
  })}\n`,
);

const exitCode = await new Promise((resolveExit, reject) => {
  const child = spawn(
    process.execPath,
    [fileURLToPath(import.meta.resolve("vitest/vitest.mjs")), ...plan.arguments],
    {
      cwd: repositoryRoot,
      env: { ...process.env, CI: "1" },
      stdio: "inherit",
    },
  );
  child.once("error", reject);
  child.once("exit", (code, signal) => {
    if (code !== null) resolveExit(code);
    else reject(new Error(`Runtime verification was terminated by signal ${signal ?? "unknown"}.`));
  });
});

process.exitCode = exitCode;
