import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { runCli } from "../src/main.js";
import type { CliServiceOverrides } from "../src/types.js";

/**
 * Keeps `lervo upgrade` tests off the developer host. Runtime retention, the host resident
 * service, and the replica service read a private home and see no running process, and the
 * upgrade takes a private full-cycle admission instead of preempting the host's residents.
 */
export function isolatedUpgradeHost(): CliServiceOverrides {
  return {
    upgradeHost: {
      homeDirectory: mkdtempSync(resolve(tmpdir(), "lervo-upgrade-home-")),
      processCommands: async () => "",
    },
    knowledgeCycleAdmission: {
      directory: mkdtempSync(resolve(tmpdir(), "lervo-upgrade-admission-")),
    },
  };
}

/** `runCli` with an isolated upgrade host; a test's own overrides take precedence. */
export function withIsolatedUpgradeHost(run: typeof runCli): typeof runCli {
  const isolated = isolatedUpgradeHost();
  return (args, io, overrides = {}) => run(args, io, { ...isolated, ...overrides });
}
