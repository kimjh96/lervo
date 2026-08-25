#!/usr/bin/env node

import { runCli } from "./main.js";

process.exitCode = await runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: (message) => process.stdout.write(message),
  stderr: (message) => process.stderr.write(message),
  stdin: async () => {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf8");
  },
});
