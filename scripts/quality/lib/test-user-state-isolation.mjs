import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// ADR-0602: macOS gives each user a temporary directory too deep for a Unix socket path, so test
// directories there would move process presence sockets to the developer's home directory. Tests
// use the system temporary directory, by its real path, as they do on Linux.
if (process.platform === "darwin" && /^(?:\/private)?\/var\/folders\//u.test(tmpdir()))
  process.env.TMPDIR = "/private/tmp";

// Vitest setup (ADR-0470): every test process reads and writes a private user state directory,
// so no test can touch the developer's host repository registry, continuity policy, host
// resident status, or user services. A test that needs another directory stubs its own.
if (process.env.LERVO_USER_STATE_DIRECTORY === undefined) {
  process.env.LERVO_USER_STATE_DIRECTORY = mkdtempSync(resolve(tmpdir(), "lervo-test-user-state-"));
}
// User capability discovery (ADR-0565) otherwise probes `~/.lervo/capabilities/packages`, so a
// developer's installed capabilities could change results and the CI ledger records host state.
if (process.env.LERVO_USER_CAPABILITY_ROOT === undefined) {
  process.env.LERVO_USER_CAPABILITY_ROOT = mkdtempSync(
    resolve(tmpdir(), "lervo-test-user-capabilities-"),
  );
}
