import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { attachNodeRuntimeSignalHandlers, type NodeRuntimeDeployment } from "../src/index.js";

function deployment(overrides: Partial<NodeRuntimeDeployment> = {}): NodeRuntimeDeployment {
  return {
    closed: new Promise(() => undefined),
    start: async () => undefined,
    reloadBearerToken: async () => undefined,
    reloadRuntimeMaterials: async () => undefined,
    close: async () => ({ status: "stopped", sync: null, remoteControl: null }),
    ...overrides,
  };
}

describe("Node runtime process signals", () => {
  it("reloads runtime materials on SIGHUP without closing the deployment", async () => {
    const signals = new EventEmitter();
    const reloadRuntimeMaterials = vi.fn(async () => undefined);
    const close = vi.fn(async () => ({
      status: "stopped" as const,
      sync: null,
      remoteControl: null,
    }));
    const binding = attachNodeRuntimeSignalHandlers(
      deployment({ reloadRuntimeMaterials, close }),
      signals,
    );
    signals.emit("SIGHUP");
    await vi.waitFor(() => expect(reloadRuntimeMaterials).toHaveBeenCalledTimes(1));
    expect(close).not.toHaveBeenCalled();
    binding.detach();
  });

  it("reports only the fixed reload failure and keeps termination separate", async () => {
    const signals = new EventEmitter();
    const failure = vi.fn();
    const close = vi.fn(async () => ({
      status: "stopped" as const,
      sync: null,
      remoteControl: null,
    }));
    const binding = attachNodeRuntimeSignalHandlers(
      deployment({
        reloadRuntimeMaterials: async () => {
          throw new Error("private material reload failure");
        },
        close,
      }),
      signals,
      failure,
    );
    signals.emit("SIGHUP");
    await vi.waitFor(() => expect(failure).toHaveBeenCalledWith("runtime_material_reload_failed"));
    expect(close).not.toHaveBeenCalled();
    signals.emit("SIGTERM");
    expect(close).toHaveBeenCalledTimes(1);
    binding.detach();
  });
});
