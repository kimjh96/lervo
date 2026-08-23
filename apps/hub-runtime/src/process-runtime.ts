import type { HubRuntimeDeployment } from "./deployment.js";

export interface HubRuntimeSignalSource {
  on(signal: "SIGINT" | "SIGTERM" | "SIGHUP", listener: () => void): unknown;
  off(signal: "SIGINT" | "SIGTERM" | "SIGHUP", listener: () => void): unknown;
}

export interface HubRuntimeSignalBinding {
  detach(): void;
}

export function attachHubRuntimeSignalHandlers(
  deployment: HubRuntimeDeployment,
  source: HubRuntimeSignalSource = process,
  onMaterialReloadFailure?: (failureCode: "runtime_material_reload_failed") => void,
): HubRuntimeSignalBinding {
  let requested = false;
  const stop = () => {
    if (requested) return;
    requested = true;
    void deployment.close();
  };
  const reload = () => {
    void deployment.reloadRuntimeMaterials().catch(() => {
      onMaterialReloadFailure?.("runtime_material_reload_failed");
    });
  };
  source.on("SIGINT", stop);
  source.on("SIGTERM", stop);
  source.on("SIGHUP", reload);
  return {
    detach() {
      source.off("SIGINT", stop);
      source.off("SIGTERM", stop);
      source.off("SIGHUP", reload);
    },
  };
}
