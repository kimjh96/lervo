import { describe, expect, it, vi } from "vitest";

const installedCheck = vi.hoisted(() => vi.fn(async () => false));
vi.mock("../src/terminal-runtime-installation.js", () => ({
  isInstalledTerminalRuntimeCli: installedCheck,
}));

const { ensureStartupHostTerminalRuntime } = await import("../src/terminal-runtime.js");

describe("ensureStartupHostTerminalRuntime", () => {
  it("does nothing for --version, which the host upgrade health gate runs on a candidate", async () => {
    await ensureStartupHostTerminalRuntime("/installed/dist/bin.js", ["--version"]);
    await ensureStartupHostTerminalRuntime("/installed/dist/bin.js", ["-v"]);
    expect(installedCheck).not.toHaveBeenCalled();
    await ensureStartupHostTerminalRuntime("/installed/dist/bin.js", [
      "host",
      "upgrade",
      "--status",
    ]);
    expect(installedCheck).toHaveBeenCalledTimes(1);
  });
});
