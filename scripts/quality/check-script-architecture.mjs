import { resolve } from "node:path";

import { inspectScriptArchitecture } from "./lib/script-architecture.mjs";

const result = await inspectScriptArchitecture({
  repositoryRoot: resolve(import.meta.dirname, "../.."),
});
if (result.issues.length > 0) {
  process.stderr.write(
    `Repository script architecture failed (${result.issues.length}):\n${result.issues.map((issue) => `  - ${issue}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Repository script architecture passed (${result.moduleCount} modules, ${result.entrypointCount} package entrypoints, ${result.repositoryReferenceCount} internal execution references, ${result.evidenceBoundExceptionCount} evidence-bound exception).\n`,
  );
}
