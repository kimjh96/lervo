import { resolve } from "node:path";

import { managedCanaryV6CheckpointContractPath } from "../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-contract.mjs";
import {
  loadPreparedManagedCanaryCheckpoint,
  prepareManagedCanaryCheckpoint,
} from "../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-preparation.mjs";
import {
  authorizeManagedCanaryV5,
  executeNextManagedCanaryV5Run,
  managedCanaryV5ExecutionStatus,
} from "../natural-language-evaluation/linked-evidence-managed-canary-v5-execution.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const [operation, argument] = process.argv.slice(2);

if (operation === "prepare") {
  const result = await prepareManagedCanaryCheckpoint(
    repositoryRoot,
    managedCanaryV6CheckpointContractPath,
  );
  process.stdout.write(
    `${JSON.stringify({ status: result.manifest.status, manifestDigest: result.manifestDigest, providerCallCeiling: result.manifest.providerCallCeiling, providerCalls: result.manifest.providerCalls, executionAuthorized: result.manifest.executionAuthorized }, null, 2)}\n`,
  );
} else if (operation === "status") {
  const result = await loadPreparedManagedCanaryCheckpoint(
    repositoryRoot,
    managedCanaryV6CheckpointContractPath,
  );
  process.stdout.write(
    `${JSON.stringify({ status: result.manifest.status, manifestDigest: result.manifestDigest, taskRunCount: result.manifest.taskRunCount, selectionCallCeiling: result.manifest.selectionCallCeiling, providerCallCeiling: result.manifest.providerCallCeiling, providerCalls: result.manifest.providerCalls, executionAuthorized: result.manifest.executionAuthorized }, null, 2)}\n`,
  );
} else if (operation === "authorize") {
  const result = await authorizeManagedCanaryV5(
    repositoryRoot,
    argument,
    managedCanaryV6CheckpointContractPath,
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else if (operation === "execute-next") {
  const result = await executeNextManagedCanaryV5Run(
    repositoryRoot,
    managedCanaryV6CheckpointContractPath,
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else if (operation === "execution-status") {
  const result = await managedCanaryV5ExecutionStatus(
    repositoryRoot,
    managedCanaryV6CheckpointContractPath,
  );
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  throw new Error("Use prepare, status, authorize, execute-next, or execution-status.");
}
