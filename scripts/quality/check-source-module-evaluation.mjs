import { resolve } from "node:path";

import { inspectSourceModuleEvaluation } from "./lib/source-module-evaluation.mjs";

const result = inspectSourceModuleEvaluation({
  repositoryRoot: resolve(import.meta.dirname, "../.."),
});
if (result.issues.length > 0) {
  process.stderr.write(
    `Source module evaluation failed (${result.issues.length}):\n${result.issues.map((issue) => `  - ${issue}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Source module evaluation passed (${result.moduleCount} modules, ${result.importCount} value imports, no cycle, no unreviewed top-level side effect).\n`,
  );
}
