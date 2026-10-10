import { fileURLToPath } from "node:url";
import { worker } from "./lib/context-quality-performance-worker.mjs";
import { run } from "./lib/context-quality-performance-runner.mjs";
const script = fileURLToPath(import.meta.url);
const args = process.argv.slice(2);
if (args[0] !== "--worker" && args.length && (args.length !== 2 || args[0] !== "--protocol")) {
  throw new Error("Usage: run-context-quality-performance.mjs [--protocol path]");
}
const result =
  args[0] === "--worker"
    ? await worker(args[1], args[2], args[3] === "warm", JSON.parse(args[4]))
    : await run(args[1] ?? "benchmarks/context-quality/recording-overhead-v1.json", script);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
