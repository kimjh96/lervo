#!/usr/bin/env node

import { runNodeRuntimeCli } from "./cli.js";
import { runDiscordWorkforceReconciliationCli } from "./discord-workforce-reconciliation-cli.js";
import { runRepositoryReplicaCli } from "./repository-replica-cli.js";

const args = process.argv.slice(2);
if (args[0] === "discord-workforce-reconcile") {
  process.exitCode = await runDiscordWorkforceReconciliationCli(args.slice(1), {
    cwd: process.cwd(),
    stdout: (message) => process.stdout.write(message),
  });
} else if (args[0] === "repository-replica") {
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    process.exitCode = await runRepositoryReplicaCli(args.slice(1), {
      cwd: process.cwd(),
      stdinBytes: async () => {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
        return new Uint8Array(Buffer.concat(chunks));
      },
      stdout: (message) => process.stdout.write(message),
      stdoutBytes: (bytes) => process.stdout.write(bytes),
      stderr: (message) => process.stderr.write(message),
      signal: abort.signal,
    });
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
} else {
  process.exitCode = await runNodeRuntimeCli(args, {
    cwd: process.cwd(),
    stdout: (message) => process.stdout.write(message),
    stderr: (message) => process.stderr.write(message),
  });
}
