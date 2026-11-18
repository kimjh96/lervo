import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { terminalHookRuntimeStorePath } from "@lervo/repository-knowledge";

import type { runCli } from "../src/main.js";
import { ensureHostTerminalRuntime } from "../src/terminal-runtime.js";
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

/**
 * `runCli` with an isolated upgrade host; a test's own overrides take precedence. ADR-0539: an
 * installed CLI publishes the host hook runtime at startup, which `runCli` skips, so the wrapper
 * publishes it once into the private home. ADR-0561 applies provider hooks within the upgrade, and
 * the event writer stage then reads that runtime.
 */
export function withIsolatedUpgradeHost(run: typeof runCli): typeof runCli {
  const isolated = isolatedUpgradeHost();
  const home = isolated.upgradeHost!.homeDirectory;
  let published: Promise<unknown> | null = null;
  return async (args, io, overrides = {}) => {
    published ??= ensureHostTerminalRuntime({
      store: terminalHookRuntimeStorePath(process.env, process.platform, home),
    });
    await published;
    return run(args, io, { ...isolated, ...overrides });
  };
}
