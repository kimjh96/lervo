import { resolve } from "node:path";

import { loadNodeRuntimeConfig } from "./config.js";
import { openNodeRuntime, type NodeRuntimeOpenPorts } from "./deployment.js";
import { NodeRuntimeError } from "./errors.js";
import { attachNodeRuntimeSignalHandlers, type NodeRuntimeSignalSource } from "./process-runtime.js";

export interface NodeRuntimeCliPorts extends NodeRuntimeOpenPorts {
  cwd: string;
  stdout(message: string): void;
  stderr(message: string): void;
  signals?: NodeRuntimeSignalSource;
}

function configArgument(args: readonly string[]): string {
  if (args.length !== 2 || args[0] !== "--config" || args[1] === undefined || args[1].length === 0) {
    throw new NodeRuntimeError("invalid_arguments", "사용법: lervo-node --config <config.json>");
  }
  return args[1];
}

export async function runNodeRuntimeCli(
  args: readonly string[],
  ports: NodeRuntimeCliPorts,
): Promise<number> {
  try {
    const path = resolve(ports.cwd, configArgument(args));
    const deployment = await openNodeRuntime(await loadNodeRuntimeConfig(path), ports);
    const signals = attachNodeRuntimeSignalHandlers(deployment, ports.signals ?? process);
    try {
      await deployment.start();
      ports.stdout("Lervo Node 동기화가 시작됐습니다.\n");
      const result = await deployment.closed;
      if (result.status === "failed") {
        ports.stderr(`Lervo Node 동기화가 중단됐습니다 (${result.failureCode}).\n`);
        return 1;
      }
      return 0;
    } finally {
      signals.detach();
      await deployment.close().catch(() => undefined);
    }
  } catch (error) {
    const failure = error instanceof NodeRuntimeError
      ? error
      : new NodeRuntimeError("startup_failed", "Lervo Node를 시작하지 못했습니다.", {
        cause: error,
      });
    ports.stderr(`Lervo Node 오류 (${failure.code}): ${failure.message}\n`);
    return 1;
  }
}
