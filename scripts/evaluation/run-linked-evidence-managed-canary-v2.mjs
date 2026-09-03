import { resolve } from "node:path";

import { managedCanaryV2CheckpointContractPath } from "../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-contract.mjs";
import {
  loadPreparedManagedCanaryCheckpoint,
  prepareManagedCanaryCheckpoint,
} from "../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-preparation.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const [operation] = process.argv.slice(2);

if (operation === "prepare") {
  const result = await prepareManagedCanaryCheckpoint(
    repositoryRoot,
    managedCanaryV2CheckpointContractPath,
  );
  process.stdout.write(
    `${JSON.stringify({ status: result.manifest.status, manifestDigest: result.manifestDigest, providerCalls: result.manifest.providerCalls, executionAuthorized: result.manifest.executionAuthorized }, null, 2)}\n`,
  );
} else if (operation === "status") {
  const result = await loadPreparedManagedCanaryCheckpoint(
    repositoryRoot,
    managedCanaryV2CheckpointContractPath,
  );
  process.stdout.write(
    `${JSON.stringify({ status: result.manifest.status, manifestDigest: result.manifestDigest, taskRunCount: result.manifest.taskRunCount, providerCallCeiling: result.manifest.providerCallCeiling, providerCalls: result.manifest.providerCalls, executionAuthorized: result.manifest.executionAuthorized }, null, 2)}\n`,
  );
} else {
  throw new Error("Use prepare or status. Live execution is not authorized by this checkpoint.");
}
