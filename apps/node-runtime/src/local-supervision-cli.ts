import { resolve } from "node:path";
import { NodeRuntimeError } from "./errors.js";
import { loadLocalSupervisionConfig } from "./local-supervision-config.js";
import type { NodeRuntimeSignalSource } from "./process-runtime.js";
import { openNodeSupervisionService } from "./supervision-startup.js";
import { readLocalSupervisionRequest } from "./local-supervision-request.js";
import {
  admitStandingSupervisionRequest,
  admitSupervisionRequest,
} from "./supervision-request-intake.js";
import { supervisionRequestRefusalCode } from "./supervision-request-refusal.js";

interface LocalSupervisionCliPorts {
  cwd: string;
  stdout(message: string): void;
  stderr(message: string): void;
  signals?: NodeRuntimeSignalSource;
  openService?: typeof openNodeSupervisionService;
  stdin?: AsyncIterable<Uint8Array | string>;
  admitRequest?: typeof admitSupervisionRequest;
}

/** Owns the local process lifetime; the existing service owns admission and all effects. */
export async function runLocalSupervisionCli(
  args: readonly string[],
  ports: LocalSupervisionCliPorts,
): Promise<number> {
  try {
    if (
      ![2, 3].includes(args.length) ||
      !["--config", "--check-config"].includes(args[0]!) ||
      !args[1] ||
      (args.length === 3 && (args[0] !== "--config" || args[2] !== "--request-stdin"))
    )
      throw new NodeRuntimeError(
        "invalid_arguments",
        "Usage: lervo-node supervise --config <config.json> [--request-stdin] | --check-config <config.json>",
      );
    const configuration = await loadLocalSupervisionConfig(resolve(ports.cwd, args[1]));
    if (args[0] === "--check-config") {
      ports.stdout("Local supervision configuration is valid; execution authority is unchecked.\n");
      return 0;
    }
    if (args[2] === "--request-stdin") {
      const request = await readLocalSupervisionRequest(ports.stdin ?? process.stdin);
      const admission = configuration.configuration.standing
        ? await admitStandingSupervisionRequest({
            repositoryRoot: configuration.repositoryRoot,
            root: configuration.configuration.binding,
            request: { source: "local", ...request },
            provider: configuration.configuration.ownerReasoning.provider,
          })
        : await (ports.admitRequest ?? admitSupervisionRequest)({
            repositoryRoot: configuration.repositoryRoot,
            binding: configuration.configuration.binding,
            request: { source: "local", ...request },
          });
      ports.stdout(
        JSON.stringify({
          schemaVersion: 1,
          component: "supervision_intake",
          eventId: admission.eventId,
          duplicate: admission.duplicate,
        }) + "\n",
      );
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
    const refusal = supervisionRequestRefusalCode(error);
    const code =
      error instanceof NodeRuntimeError
        ? error.code
        : refusal === null
          ? "startup_failed"
          : `request_refused_${refusal}`;
    ports.stderr(`Local supervision error (${code}).\n`);
    return 1;
  }
}
