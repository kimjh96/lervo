import { fileURLToPath } from "node:url";
import { activeWorker } from "./lib/context-quality-active-worker.mjs";
import { runActive } from "./lib/context-quality-active-runner.mjs";
const args = process.argv.slice(2);
let result;
if (args[0] === "--worker" && args.length === 6)
  result = await activeWorker(args[1], args[2], args[3], Number(args[4]), JSON.parse(args[5]));
else if (args.length === 2 && args[0] === "--protocol")
  result = await runActive(args[1], fileURLToPath(import.meta.url));
else throw new Error("Usage: run-context-quality-active-performance.mjs --protocol path");
process.stdout.write(JSON.stringify(result) + "\n");
