#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runTerminalCommand } from "./terminal-command.js";

async function verifiedRuntime(): Promise<boolean> {
  try {
    const runtimePath = fileURLToPath(import.meta.url);
    const manifest = JSON.parse(
      await readFile(resolve(dirname(runtimePath), "runtime-v2.json"), "utf8"),
    ) as Record<string, unknown>;
    const content = await readFile(runtimePath);
    return (
      manifest.schemaVersion === 1 &&
      manifest.kind === "lervo_terminal_hook_runtime" &&
      manifest.contractId === "lervo_terminal_hooks_v2" &&
      manifest.runtimePath === ".lervo/generated/terminal-hooks/runtime-v2.mjs" &&
      manifest.byteCount === content.byteLength &&
      manifest.contentHash === `sha256:${createHash("sha256").update(content).digest("hex")}`
    );
  } catch {
    return false;
  }
}

if (!(await verifiedRuntime())) {
  process.stderr.write("Lervo terminal hook runtime integrity verification failed.\n");
  process.exitCode = 2;
} else {
  process.exitCode = await runTerminalCommand(["hook", ...process.argv.slice(2)], {
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
}
