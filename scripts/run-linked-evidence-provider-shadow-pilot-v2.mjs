import { resolve } from "node:path";

import { runProviderShadowPilot } from "./natural-language-evaluation/linked-evidence-provider-shadow-pilot-runner.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const [
  operation,
  contractPath = "benchmarks/search/linked-evidence-provider-shadow-pilot-v2.json",
] = process.argv.slice(2);
const result = await runProviderShadowPilot(repositoryRoot, contractPath, operation);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
