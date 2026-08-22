#!/usr/bin/env node

import { runHubRuntimeCli } from "./cli.js";

process.exitCode = await runHubRuntimeCli(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: (message) => process.stdout.write(message),
  stderr: (message) => process.stderr.write(message),
});
