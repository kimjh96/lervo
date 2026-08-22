#!/usr/bin/env node

import { runNodeRuntimeCli } from "./cli.js";

process.exitCode = await runNodeRuntimeCli(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: (message) => process.stdout.write(message),
  stderr: (message) => process.stderr.write(message),
});
