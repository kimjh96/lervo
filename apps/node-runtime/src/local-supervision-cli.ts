import { resolve } from "node:path";
import { NodeRuntimeError } from "./errors.js";
import { loadLocalSupervisionConfig } from "./local-supervision-config.js";
import type { NodeRuntimeSignalSource } from "./process-runtime.js";
import { openNodeSupervisionService } from "./supervision-startup.js";

interface LocalSupervisionCliPorts {
  cwd: string;
  stdout(message: string): void;
  stderr(message: string): void;
  signals?: NodeRuntimeSignalSource;
  openService?: typeof openNodeSupervisionService;
}

/** Owns the local process lifetime; the existing service owns admission and all effects. */
export async function runLocalSupervisionCli(
  args: readonly string[],
  ports: LocalSupervisionCliPorts,
): Promise<number> {
  try {
    if (args.length !== 2 || !["--config", "--check-config"].includes(args[0]!) || !args[1])
      throw new NodeRuntimeError(
        "invalid_arguments",
        "Usage: lervo-node supervise --config <config.json> | --check-config <config.json>",
      );
    const configuration = await loadLocalSupervisionConfig(resolve(ports.cwd, args[1]));
    if (args[0] === "--check-config") {
      ports.stdout("Local supervision configuration is valid; execution authority is unchecked.\n");
      return 0;
    }
    const signals = ports.signals ?? process;
    let stopRequested = false;
    let resolveStop!: () => void;
    const stopped = new Promise<void>((resolve) => {
      resolveStop = resolve;
    });
    const stop = () => {
      stopRequested = true;
      resolveStop();
    };
    signals.on("SIGINT", stop);
    signals.on("SIGTERM", stop);
    let service: Awaited<ReturnType<typeof openNodeSupervisionService>> | undefined;
    try {
      service = await (ports.openService ?? openNodeSupervisionService)({
        ...configuration,
        observeHealth: async (health) => {
          ports.stdout(
            JSON.stringify({ schemaVersion: 1, component: "supervision", ...health }) + "\n",
          );
        },
      });
      if (stopRequested) return 0;
      service.start();
      const result = await Promise.race([
        stopped.then(() => "stopped" as const),
        service.failed.then(() => "failed" as const),
      ]);
      if (result === "failed") {
        ports.stderr("Local supervision stopped (supervision_runtime_failed).\n");
        return 1;
      }
      return 0;
    } finally {
      try {
        await service?.close();
      } finally {
        signals.off("SIGINT", stop);
        signals.off("SIGTERM", stop);
      }
    }
  } catch (error) {
    const code = error instanceof NodeRuntimeError ? error.code : "startup_failed";
    ports.stderr(`Local supervision error (${code}).\n`);
    return 1;
  }
}
