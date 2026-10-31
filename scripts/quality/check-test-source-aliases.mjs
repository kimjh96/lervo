import { resolve } from "node:path";

import { inspectTestSourceAliases } from "./lib/test-source-aliases.mjs";

const result = inspectTestSourceAliases(resolve(import.meta.dirname, "../.."));
if (result.issues.length > 0) {
  process.stderr.write(
    `Test source aliases failed:\n${result.issues.map((issue) => `  - ${issue}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Test source aliases passed (${result.packageCount} packages, ${result.testFileCount} test and helper files).\n`,
  );
}
