import { resolve } from "node:path";

import { executePhaseAPilot } from "../natural-language-evaluation/linked-evidence-shadow-phase-a-pilot-execution.mjs";
import { reviewPhaseAPilot } from "../natural-language-evaluation/linked-evidence-shadow-phase-a-pilot-review.mjs";
import { preparePhaseAPilot } from "../natural-language-evaluation/linked-evidence-shadow-phase-a-pilot-workspace.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const action = process.argv[2];
const contractPath = process.argv[3];

if (action === "prepare") {
  const prepared = await preparePhaseAPilot(repositoryRoot, contractPath);
  process.stdout.write(
    `${JSON.stringify({ status: "prepared", pilotRoot: prepared.paths.root, manifestDigest: prepared.manifestDigest, corpusCount: prepared.manifest.corpus.length, nonemptyProjectionCount: prepared.manifest.nonemptyProjectionCount }, null, 2)}\n`,
  );
} else if (action === "execute") {
  const receipts = await executePhaseAPilot(repositoryRoot, contractPath, (event) => {
    process.stdout.write(`${JSON.stringify(event)}\n`);
  });
  process.stdout.write(
    `${JSON.stringify({ status: "executed", runCount: receipts.receipts.length })}\n`,
  );
} else if (action === "review") {
  process.stdout.write(
    `${JSON.stringify(await reviewPhaseAPilot(repositoryRoot, contractPath), null, 2)}\n`,
  );
} else {
  process.stderr.write(
    "Usage: node scripts/evaluation/run-linked-evidence-shadow-phase-a-pilot.mjs <prepare|execute|review> [contract-path]\n",
  );
  process.exitCode = 1;
}
