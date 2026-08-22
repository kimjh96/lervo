import type { HubRuntimeDeployment } from "./deployment.js";

export interface HubRuntimeSignalSource {
  on(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
  off(signal: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}

export interface HubRuntimeSignalBinding {
  detach(): void;
}

export function attachHubRuntimeSignalHandlers(
  deployment: HubRuntimeDeployment,
  source: HubRuntimeSignalSource = process,
): HubRuntimeSignalBinding {
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
