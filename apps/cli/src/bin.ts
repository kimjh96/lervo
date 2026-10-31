#!/usr/bin/env node

import { fileURLToPath } from "node:url";

import { ensureStartupHostTerminalRuntime, runCli } from "./main.js";

process.env.LERVO_CLI_ENTRY = fileURLToPath(import.meta.url);

// ADR-0539: through the repository runtime, so the thin entry never bundles the CLI twice.
await ensureStartupHostTerminalRuntime(process.env.LERVO_CLI_ENTRY, process.argv.slice(2));

process.exitCode = await runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: (message) => process.stdout.write(message),
  stderr: (message) => process.stderr.write(message),
  stdin: async (maximumBytes) => {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.byteLength;
      if (maximumBytes !== undefined && bytes > maximumBytes)
        throw new Error("Standard input exceeds the requested byte limit.");
      chunks.push(buffer);
    }
    return Buffer.concat(chunks).toString("utf8");
  },
});
