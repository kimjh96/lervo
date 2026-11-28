#!/usr/bin/env node

import { consumeTerminalRuntimeLaunchReceipt } from "./terminal-runtime-launch-receipt.js";
import { verifyTerminalHookRuntimeArtifact } from "@lervo/repository-knowledge";

import { fileURLToPath } from "node:url";

import { runKnowledgeBootstrap } from "./knowledge-bootstrap.js";
import { runTerminalHookCommand } from "./terminal-hook-command.js";
import { createTerminalStageObservation } from "./terminal-stage-observation.js";
import { inProcessHookDelivery } from "./terminal-hook-delivery.js";
import { prefetchTerminalPromptContext } from "./terminal-compact-context.js";
import { settleTerminalTurns } from "./terminal-turn-settlement-worker.js";
import { serveTerminalContext } from "./terminal-context-serve.js";

if (
  !consumeTerminalRuntimeLaunchReceipt(fileURLToPath(import.meta.url)) &&
  !(await verifyTerminalHookRuntimeArtifact(fileURLToPath(import.meta.url)))
) {
  process.stderr.write("Lervo terminal hook runtime integrity verification failed.\n");
  process.exitCode = 2;
} else if (process.argv[2] === "prefetch-context") {
  // Detached after Stop; a failure only means the next prompt computes the snapshot itself.
  await prefetchTerminalPromptContext(process.cwd()).catch(() => undefined);
} else if (process.argv[2] === "settle-turns") {
  // Schema 12: records the turns that ended without a Stop hook, from their settlement requests.
  await settleTerminalTurns(process.cwd()).catch(() => 0);
} else if (process.argv[2] === "context-server") {
  // Started and supervised by the host's knowledge resident (resident-context-socket.md).
  const entry = fileURLToPath(import.meta.url);
  process.env.LERVO_TERMINAL_HOOK_RUNTIME = entry;
  await serveTerminalContext(entry);
} else if (process.argv[2] === "knowledge-bootstrap") {
  // Detached from the first prompt of a checkout without built knowledge; it records its outcome.
  await runKnowledgeBootstrap({ root: process.cwd() });
} else {
  process.env.LERVO_TERMINAL_HOOK_RUNTIME = fileURLToPath(import.meta.url);
  // Read before the hook runs: why the launcher ran it here instead of the context server.
  const delivery = inProcessHookDelivery();
  process.exitCode = await runTerminalHookCommand(
    process.argv.slice(2),
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
      createTerminalStageObservation: (digest) =>
        Object.assign(createTerminalStageObservation(digest), { delivery: () => delivery }),
    },
    // A claim's budget counts from this process's start, which includes the launcher's wait for a
    // server, because the provider's claim hook timeout does (ADR-0652).
    process.argv.includes("--claim") ? 0 : undefined,
  );
  // Deadline races cannot cancel every filesystem or child-process handle. Flush the response
  // before ending this short-lived hook process; detached maintenance has its own process.
  process.stdout.write("", () => process.exit(process.exitCode ?? 0));
}
