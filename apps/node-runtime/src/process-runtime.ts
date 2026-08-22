import type { NodeRuntimeDeployment } from "./lifecycle.js";

export interface NodeRuntimeSignalSource {
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

export interface NodeRuntimeSignalBinding {
  detach(): void;
}

export function attachNodeRuntimeSignalHandlers(
  deployment: NodeRuntimeDeployment,
  source: NodeRuntimeSignalSource = process,
): NodeRuntimeSignalBinding {
  let requested = false;
  const stop = () => {
    if (requested) return;
    requested = true;
    void deployment.close();
  };
  source.on("SIGINT", stop);
  source.on("SIGTERM", stop);
  return {
    detach() {
      source.off("SIGINT", stop);
      source.off("SIGTERM", stop);
    },
  };
}
