#!/usr/bin/env node

import { runCli } from "./main.js";

process.exitCode = await runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  stdout: (message) => process.stdout.write(message),
  stderr: (message) => process.stderr.write(message),
});
