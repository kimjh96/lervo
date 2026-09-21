import { describe, expect, it, vi } from "vitest";

import {
  ConversationRequestedRuntimeManager,
  type ConversationRequestedRuntimeProcess,
} from "../src/conversation-requested-runtime.js";

const target = {
  runtimeId: "preview",
  displayName: "Preview server",
  executable: "/usr/bin/node",
  arguments: ["server.js"],
  workingDirectory: "/workspace",
  maximumLifetimeMs: 60_000,
  startupTimeoutMs: 5_000,
  stopTimeoutMs: 1_000,
};

function controlledProcess() {
  let exit!: (value: { exitCode: number | null; signal: string | null }) => void;
  const process: ConversationRequestedRuntimeProcess = {
    exited: new Promise((resolve) => {
      exit = resolve;
    }),
    stop: vi.fn(async () => exit({ exitCode: null, signal: "SIGTERM" })),
  };
  return { process, exit };
}

describe("conversation requested runtime manager", () => {
  it("opens once, remains independent of the provider turn, and stops explicitly", async () => {
    const child = controlledProcess();
    const start = vi.fn(async () => child.process);
    const manager = new ConversationRequestedRuntimeManager([target], { start });

    await expect(manager.open("preview")).resolves.toBe("opened");
    await expect(manager.open("preview")).resolves.toBe("already_open");
    expect(start).toHaveBeenCalledTimes(1);

    await expect(manager.close("preview")).resolves.toBe("closed");
    await expect(manager.close("preview")).resolves.toBe("already_closed");
    expect(child.process.stop).toHaveBeenCalledOnce();
    expect(child.process.stop).toHaveBeenCalledWith(1_000);
  });

  it("does not restart an exited process and permits a later explicit open", async () => {
    const first = controlledProcess();
    const second = controlledProcess();
    const start = vi
      .fn<() => Promise<ConversationRequestedRuntimeProcess>>()
      .mockResolvedValueOnce(first.process)
      .mockResolvedValueOnce(second.process);
    const manager = new ConversationRequestedRuntimeManager([target], { start });

    await manager.open("preview");
    first.exit({ exitCode: 1, signal: null });
    await first.process.exited;
    await Promise.resolve();
    await Promise.resolve();

    await expect(manager.open("preview")).resolves.toBe("opened");
    expect(start).toHaveBeenCalledTimes(2);
    expect(first.process.stop).toHaveBeenCalledOnce();
    await manager.closeAll();
  });

  it("rejects an unconfigured target before starting a process", async () => {
    const start = vi.fn();
    const manager = new ConversationRequestedRuntimeManager([target], { start });

    await expect(manager.open("unknown")).rejects.toThrow("not configured");
    expect(start).not.toHaveBeenCalled();
  });

  it("stops at the configured maximum lifetime without restarting", async () => {
    vi.useFakeTimers();
    try {
      const child = controlledProcess();
      const start = vi.fn(async () => child.process);
      const manager = new ConversationRequestedRuntimeManager([target], { start });

      await manager.open("preview");
      await vi.advanceTimersByTimeAsync(60_000);

      expect(child.process.stop).toHaveBeenCalledOnce();
      expect(start).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("single-flights concurrent opens and lets a close wait for startup", async () => {
    const child = controlledProcess();
    let releaseStart!: () => void;
    const start = vi.fn(
      () =>
        new Promise<ConversationRequestedRuntimeProcess>((resolve) => {
          releaseStart = () => resolve(child.process);
        }),
    );
    const manager = new ConversationRequestedRuntimeManager([target], { start });

    const firstOpen = manager.open("preview");
    const duplicateOpen = manager.open("preview");
    const close = manager.close("preview");
    releaseStart();

    await expect(firstOpen).resolves.toBe("opened");
    await expect(duplicateOpen).resolves.toBe("already_open");
    await expect(close).resolves.toBe("closed");
    expect(start).toHaveBeenCalledOnce();
    expect(child.process.stop).toHaveBeenCalledOnce();
  });
});
