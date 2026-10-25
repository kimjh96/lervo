#!/usr/bin/env node

import { verifyTerminalHookRuntimeArtifact } from "@lervo/repository-knowledge";

import { fileURLToPath } from "node:url";

import { runKnowledgeWorkerCommand } from "./knowledge-worker-command.js";
import { runTerminalCommand } from "./terminal-command.js";
import { projectProductionSearchQueries } from "./provider-query-projector.js";
import { createTerminalStageObservation } from "./terminal-stage-observation.js";
import { prefetchTerminalPromptContext } from "./terminal-compact-context.js";

if (!(await verifyTerminalHookRuntimeArtifact(fileURLToPath(import.meta.url)))) {
  process.stderr.write("Lervo terminal hook runtime integrity verification failed.\n");
  process.exitCode = 2;
} else if (process.argv[2] === "prefetch-context") {
  // Detached after Stop; a failure only means the next prompt computes the snapshot itself.
  await prefetchTerminalPromptContext(process.cwd()).catch(() => undefined);
} else if (process.argv[2] === "knowledge-worker") {
  process.exitCode = await runKnowledgeWorkerCommand(["--once", ...process.argv.slice(3)], {
    cwd: process.cwd(),
    stdout: (message) => process.stdout.write(message),
    stderr: (message) => process.stderr.write(message),
  });
} else {
  process.env.LERVO_TERMINAL_HOOK_RUNTIME = fileURLToPath(import.meta.url);
  process.exitCode = await runTerminalCommand(
    ["hook", ...process.argv.slice(2)],
    {
      cwd: process.cwd(),
      stdout: (message) => process.stdout.write(message),
      stderr: (message) => process.stderr.write(message),
      stdin: async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin)
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        return Buffer.concat(chunks).toString("utf8");
      },
    },
    {
      projectSearchQueries: projectProductionSearchQueries,
      createTerminalStageObservation,
    },
  );
  // Deadline races cannot cancel every filesystem or child-process handle. Flush the response
  // before ending this short-lived hook process; detached maintenance has its own process.
  process.stdout.write("", () => process.exit(process.exitCode ?? 0));
}
