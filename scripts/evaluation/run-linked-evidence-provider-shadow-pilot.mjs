import { resolve } from "node:path";

import { CodexAdapter } from "../../packages/adapter-codex/dist/index.js";

import { executeProviderShadowPilot } from "../natural-language-evaluation/linked-evidence-provider-shadow-pilot-execution.mjs";
import { prepareProviderShadowPilot } from "../natural-language-evaluation/linked-evidence-provider-shadow-pilot-preparation.mjs";
import { reviewProviderShadowPilot } from "../natural-language-evaluation/linked-evidence-provider-shadow-pilot-review.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const [
  operation,
  contractPath = "benchmarks/search/linked-evidence-provider-shadow-pilot-v1.json",
] = process.argv.slice(2);

function createAdapter(root, model) {
  return new CodexAdapter({
    repositoryRoot: root,
    model,
    sandbox: "read-only",
    approvalPolicy: "never",
  });
}

function progress(value) {
  process.stderr.write(`${JSON.stringify(value)}\n`);
}

let result;
if (operation === "prepare") {
  const prepared = await prepareProviderShadowPilot(repositoryRoot, contractPath);
  result = {
    status: "prepared",
    pilotId: prepared.manifest.pilotId,
    manifestDigest: prepared.manifestDigest,
    scheduleCount: prepared.manifest.schedule.length,
    maximumCandidateSources: prepared.manifest.maximumCandidateSources,
    maximumProviderVisibleSourceBytes: prepared.manifest.maximumProviderVisibleSourceBytes,
    providerCalls: prepared.manifest.providerCalls,
  };
} else if (operation === "execute") {
  result = await executeProviderShadowPilot(repositoryRoot, contractPath, createAdapter, progress);
} else if (operation === "review") {
  result = await reviewProviderShadowPilot(repositoryRoot, contractPath);
} else {
  throw new TypeError("Use prepare, execute, or review.");
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
