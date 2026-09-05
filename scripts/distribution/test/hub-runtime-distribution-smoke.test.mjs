import assert from "node:assert/strict";

import { it } from "vitest";

import { observeProcessReadiness } from "../lib/hub-runtime-distribution-smoke.mjs";

it("observes readiness output beyond the previous fixed shutdown deadline", async () => {
  const ready = await observeProcessReadiness({
    command: process.execPath,
    arguments: [
      "--input-type=module",
      "--eval",
      'setTimeout(() => process.stdout.write("ready\\n"), 1_600); setInterval(() => {}, 1_000);',
    ],
    cwd: process.cwd(),
    expectedStdout: "ready\n",
    readinessTimeoutMs: 3_000,
    shutdownTimeoutMs: 2_000,
  });
  assert.equal(ready, true);
});

it("rejects unexpected process output", async () => {
  const ready = await observeProcessReadiness({
    command: process.execPath,
    arguments: ["--input-type=module", "--eval", 'process.stderr.write("not ready\\n");'],
    cwd: process.cwd(),
    expectedStdout: "ready\n",
    readinessTimeoutMs: 2_000,
    shutdownTimeoutMs: 2_000,
  });
  assert.equal(ready, false);
});
