import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// Vitest setup (ADR-0470): every test process reads and writes a private user state directory,
// so no test can touch the developer's host repository registry, continuity policy, host
// resident status, or user services. A test that needs another directory stubs its own.
if (process.env.LERVO_USER_STATE_DIRECTORY === undefined) {
  process.env.LERVO_USER_STATE_DIRECTORY = mkdtempSync(resolve(tmpdir(), "lervo-test-user-state-"));
}
