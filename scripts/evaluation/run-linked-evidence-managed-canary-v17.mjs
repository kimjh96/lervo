import { resolve } from "node:path";

import { managedCanaryV17CheckpointContractPath } from "../natural-language-evaluation/linked-evidence-managed-canary-checkpoint-contract.mjs";
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

function summary(result) {
  return {
    status: result.manifest.status,
    manifestDigest: result.manifestDigest,
    sourceRevision: result.manifest.sourceRevision,
    builtCliDigest: result.manifest.builtCliDigest,
    taskRunCount: result.manifest.taskRunCount,
    selectionCallCeiling: result.manifest.selectionCallCeiling,
    providerCallCeiling: result.manifest.providerCallCeiling,
    providerCalls: result.manifest.providerCalls,
    executionAuthorized: result.manifest.executionAuthorized,
  };
}

if (operation === "prepare") {
  const result = await prepareManagedCanaryCheckpoint(
    repositoryRoot,
    managedCanaryV17CheckpointContractPath,
  );
  process.stdout.write(`${JSON.stringify(summary(result), null, 2)}\n`);
} else if (operation === "status") {
  const result = await loadPreparedManagedCanaryCheckpoint(
    repositoryRoot,
    managedCanaryV17CheckpointContractPath,
  );
  process.stdout.write(`${JSON.stringify(summary(result), null, 2)}\n`);
} else if (operation === "authorize") {
  process.stdout.write(
    `${JSON.stringify(
      await authorizeManagedCanaryV5(
        repositoryRoot,
        argument,
        managedCanaryV17CheckpointContractPath,
      ),
      null,
      2,
    )}\n`,
  );
} else if (operation === "execute-next") {
  process.stdout.write(
    `${JSON.stringify(
      await executeNextManagedCanaryV5Run(repositoryRoot, managedCanaryV17CheckpointContractPath),
      null,
      2,
    )}\n`,
  );
} else if (operation === "execution-status") {
  process.stdout.write(
    `${JSON.stringify(
      await managedCanaryV5ExecutionStatus(repositoryRoot, managedCanaryV17CheckpointContractPath),
      null,
      2,
    )}\n`,
  );
} else {
  throw new Error("Use prepare, status, authorize, execute-next, or execution-status.");
}
