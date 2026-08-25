import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { attachHubRuntimeSignalHandlers, type HubRuntimeDeployment } from "../src/index.js";

function deployment(overrides: Partial<HubRuntimeDeployment> = {}): HubRuntimeDeployment {
  return {
    closed: new Promise(() => undefined),
    listen: async () => ({ host: "127.0.0.1", port: 8787, protocol: "https" }),
    reloadCredentials: async () => undefined,
    reloadRuntimeMaterials: async () => undefined,
    close: async () => ({
      status: "stopped",
      artifactCleanup: { status: "stopped", loop: null },
    }),
    ...overrides,
  };
}

describe("Hub runtime process signals", () => {
  it("reloads credentials on SIGHUP without closing the deployment", async () => {
    const signals = new EventEmitter();
    const reloadRuntimeMaterials = vi.fn(async () => undefined);
    const close = vi.fn(async () => ({
      status: "stopped" as const,
      artifactCleanup: { status: "stopped" as const, loop: null },
    }));
    const binding = attachHubRuntimeSignalHandlers(
      deployment({ reloadRuntimeMaterials, close }),
      signals,
    );
    signals.emit("SIGHUP");
    await vi.waitFor(() => expect(reloadRuntimeMaterials).toHaveBeenCalledTimes(1));
    expect(close).not.toHaveBeenCalled();
    binding.detach();
  });

  it("reports a fixed reload failure and keeps termination separate", async () => {
    const signals = new EventEmitter();
    const failure = vi.fn();
    const close = vi.fn(async () => ({
      status: "stopped" as const,
      artifactCleanup: { status: "stopped" as const, loop: null },
    }));
    const binding = attachHubRuntimeSignalHandlers(
      deployment({
        reloadRuntimeMaterials: async () => {
          throw new Error("private reload failure");
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
