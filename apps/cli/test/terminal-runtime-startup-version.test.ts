import { afterEach, describe, expect, it, vi } from "vitest";

import { installedCliProbes } from "../src/host-link-activation.js";
import { STARTUP_EFFECTS_VARIABLE } from "../src/startup-effects.js";

const installedCheck = vi.hoisted(() => vi.fn(async () => false));
vi.mock("../src/terminal-runtime-installation.js", () => ({
  isInstalledTerminalRuntimeCli: installedCheck,
}));
const childProcess = vi.hoisted(() => ({
  execFile: vi.fn(
    (
      _command: string,
      _args: string[],
      _options: { env?: NodeJS.ProcessEnv },
      done: (error: null, stdout: string) => void,
    ) => done(null, "lervo 1.2.3\n"),
  ),
}));
vi.mock("node:child_process", () => childProcess);

const { ensureStartupHostTerminalRuntime } = await import("../src/terminal-runtime.js");

afterEach(() => {
  vi.unstubAllEnvs();
  installedCheck.mockClear();
  childProcess.execFile.mockClear();
});

describe("startup effects", () => {
  it("still refresh the host runtime for an ordinary --version after an upgrade", async () => {
    await ensureStartupHostTerminalRuntime("/installed/dist/bin.js", ["--version"]);
    expect(installedCheck).toHaveBeenCalledTimes(1);
  });

  it("are skipped only when the host upgrade probe asks", async () => {
    vi.stubEnv(STARTUP_EFFECTS_VARIABLE, "skip");
    await ensureStartupHostTerminalRuntime("/installed/dist/bin.js", ["--version"]);
    await ensureStartupHostTerminalRuntime("/installed/dist/bin.js", ["host", "upgrade"]);
    expect(installedCheck).not.toHaveBeenCalled();
  });

  it("are skipped by the health gate's version probe of a candidate", async () => {
    await expect(installedCliProbes.version("/candidate/bin/lervo")).resolves.toBe("lervo 1.2.3\n");
    const [command, args, options] = childProcess.execFile.mock.calls[0] ?? [];
    expect([command, args]).toEqual(["/candidate/bin/lervo", ["--version"]]);
    expect(options?.env?.[STARTUP_EFFECTS_VARIABLE]).toBe("skip");
    expect(process.env[STARTUP_EFFECTS_VARIABLE]).toBeUndefined();
  });
});
