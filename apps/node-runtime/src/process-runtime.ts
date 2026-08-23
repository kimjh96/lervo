import type { NodeRuntimeDeployment } from "./lifecycle.js";

export interface NodeRuntimeSignalSource {
  on(signal: "SIGINT" | "SIGTERM" | "SIGHUP", listener: () => void): unknown;
  off(signal: "SIGINT" | "SIGTERM" | "SIGHUP", listener: () => void): unknown;
}

export interface NodeRuntimeSignalBinding {
  detach(): void;
}

export function attachNodeRuntimeSignalHandlers(
  deployment: NodeRuntimeDeployment,
  source: NodeRuntimeSignalSource = process,
  onMaterialReloadFailure?: (failureCode: "runtime_material_reload_failed") => void,
): NodeRuntimeSignalBinding {
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
