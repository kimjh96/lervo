import { resolve } from "node:path";

import { loadHubRuntimeConfig } from "./config.js";
import { openHubRuntime } from "./deployment.js";
import { HubRuntimeError } from "./errors.js";
import { attachHubRuntimeSignalHandlers, type HubRuntimeSignalSource } from "./process-runtime.js";

export interface HubRuntimeCliPorts {
  cwd: string;
  stdout(message: string): void;
  stderr(message: string): void;
  signals?: HubRuntimeSignalSource;
}

function configArgument(args: readonly string[]): string {
  if (
    args.length !== 2 ||
    args[0] !== "--config" ||
    args[1] === undefined ||
    args[1].length === 0
  ) {
    throw new HubRuntimeError("invalid_arguments", "Usage: lervo-hub --config <config.json>");
  }
  return args[1];
}

export async function runHubRuntimeCli(
  args: readonly string[],
  ports: HubRuntimeCliPorts,
): Promise<number> {
  try {
    const path = resolve(ports.cwd, configArgument(args));
    const deployment = await openHubRuntime(await loadHubRuntimeConfig(path), {
      stderr: (message) => ports.stderr(message),
    });
    const signals = attachHubRuntimeSignalHandlers(
      deployment,
      ports.signals ?? process,
      (failureCode) =>
        ports.stderr(`Failed to reload Lervo Hub runtime material (${failureCode}).\n`),
    );
    try {
      const address = await deployment.listen();
      ports.stdout(`Lervo Hub started on ${address.host}:${address.port}.\n`);
      const result = await deployment.closed;
      if (result.serverDrain === "forced") {
        ports.stderr("Lervo Hub forced remaining HTTP connections closed after drain timeout.\n");
      }
      if (result.status === "failed") {
        ports.stderr(`Lervo Hub stopped (${result.failureCode}).\n`);
        return 1;
      }
      return 0;
    } finally {
      signals.detach();
      await deployment.close().catch(() => undefined);
    }
  } catch (error) {
    const failure =
      error instanceof HubRuntimeError
        ? error
        : new HubRuntimeError("startup_failed", "Could not start Lervo Hub.", { cause: error });
    ports.stderr(`Lervo Hub error (${failure.code}): ${failure.message}\n`);
    return 1;
  }
}
