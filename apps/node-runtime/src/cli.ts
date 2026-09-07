import { resolve } from "node:path";

import { loadNodeRuntimeConfig } from "./config.js";
import { preflightNodeRuntimeCredentials } from "./config-preflight.js";
import { openNodeRuntime } from "./deployment.js";
import { NodeRuntimeError } from "./errors.js";
import type { NodeRuntimeOpenPorts } from "./open-ports.js";
import { createManagedProviderRemoteCommandPorts } from "./managed-provider-runtime.js";
import {
  attachNodeRuntimeSignalHandlers,
  type NodeRuntimeSignalSource,
} from "./process-runtime.js";

export interface NodeRuntimeCliPorts extends NodeRuntimeOpenPorts {
  cwd: string;
  stdout(message: string): void;
  stderr(message: string): void;
  signals?: NodeRuntimeSignalSource;
}

function configArgument(args: readonly string[]): { mode: "run" | "check"; path: string } {
  if (
    args.length !== 2 ||
    (args[0] !== "--config" && args[0] !== "--check-config") ||
    args[1] === undefined ||
    args[1].length === 0
  ) {
    throw new NodeRuntimeError(
      "invalid_arguments",
      "Usage: lervo-node --config <config.json> | --check-config <config.json>",
    );
  }
  return { mode: args[0] === "--config" ? "run" : "check", path: args[1] };
}

export async function runNodeRuntimeCli(
  args: readonly string[],
  ports: NodeRuntimeCliPorts,
): Promise<number> {
  try {
    const request = configArgument(args);
    const path = resolve(ports.cwd, request.path);
    const config = await loadNodeRuntimeConfig(path);
    if (request.mode === "check") {
      await preflightNodeRuntimeCredentials(config);
      ports.stdout("Lervo Node configuration preflight passed.\n");
      return 0;
    }
    const managedRemoteCommands = createManagedProviderRemoteCommandPorts(config);
    const deployment = await openNodeRuntime(config, {
      ...ports,
      ...(ports.remoteCommands !== undefined
        ? { remoteCommands: ports.remoteCommands }
        : managedRemoteCommands === undefined
          ? {}
          : { remoteCommands: managedRemoteCommands }),
    });
    const signals = attachNodeRuntimeSignalHandlers(
      deployment,
      ports.signals ?? process,
      (failureCode) =>
        ports.stderr(`Failed to reload Lervo Node runtime material (${failureCode}).\n`),
    );
    try {
      await deployment.start();
      ports.stdout("Lervo Node synchronization started.\n");
      const result = await deployment.closed;
      if (result.status === "failed") {
        ports.stderr(`Lervo Node synchronization stopped (${result.failureCode}).\n`);
        return 1;
      }
      return 0;
    } finally {
      signals.detach();
      await deployment.close().catch(() => undefined);
    }
  } catch (error) {
    const failure =
      error instanceof NodeRuntimeError
        ? error
        : new NodeRuntimeError("startup_failed", "Could not start Lervo Node.", {
            cause: error,
          });
    ports.stderr(`Lervo Node error (${failure.code}): ${failure.message}\n`);
    return 1;
  }
}
