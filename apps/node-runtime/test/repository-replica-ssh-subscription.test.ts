import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { SshRepositoryReplicaPeer } from "../src/repository-replica-ssh-peer.js";

it.each([true, false])(
  "bounds subscription frames and disposes the remote process (valid=%s)",
  async (valid) => {
    const root = await mkdtemp(join(tmpdir(), "lervo-peer-hints-"));
    let stop: (() => void) | undefined;
    try {
      const script = join(root, "peer.mjs");
      await writeFile(
        script,
        `process.stdout.write(${JSON.stringify(valid ? '{"schemaVersion":1,"status":"changed"}\n' : "invalid\n")}); setInterval(() => {}, 10000);`,
      );
      const peer = new SshRepositoryReplicaPeer({
        executable: process.execPath,
        arguments: [script],
        destination: "fixture",
        remoteNodeExecutable: "node",
        remoteRuntimeExecutable: "runtime",
      });
      const changed = vi.fn();
      const failed = vi.fn();
      stop = peer.subscribe("/fixture", changed, failed);
      await vi.waitFor(() => expect(valid ? changed : failed).toHaveBeenCalledOnce());
      expect(valid ? failed : changed).not.toHaveBeenCalled();
      stop();
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(failed).toHaveBeenCalledTimes(valid ? 0 : 1);
    } finally {
      stop?.();
      await rm(root, { recursive: true, force: true });
    }
  },
);

it("arms no timer for a quiet stream, ignores an older peer's alive line, and fails only at EOF (ADR-0602)", async () => {
  const root = await mkdtemp(join(tmpdir(), "lervo-peer-quiet-"));
  let stop: (() => void) | undefined;
  const timeouts = vi.spyOn(globalThis, "setTimeout");
  try {
    const script = join(root, "peer.mjs");
    // An older peer says `alive`, then a change, then its link ends.
    await writeFile(
      script,
      `process.stdout.write('{"schemaVersion":1,"status":"alive"}\\n'); setTimeout(() => process.stdout.write('{"schemaVersion":1,"status":"changed"}\\n'), 200); setTimeout(() => process.exit(0), 600);`,
    );
    const peer = new SshRepositoryReplicaPeer({
      executable: process.execPath,
      arguments: [script],
      destination: "fixture",
      remoteNodeExecutable: "node",
      remoteRuntimeExecutable: "runtime",
    });
    const changed = vi.fn();
    const failed = vi.fn();
    const armed = timeouts.mock.calls.length;
    stop = peer.subscribe("/fixture", changed, failed);
    expect(timeouts.mock.calls.length).toBe(armed);
    await vi.waitFor(() => expect(changed).toHaveBeenCalledOnce(), { timeout: 5_000 });
    expect(failed).not.toHaveBeenCalled();
    // Nothing but the end of the stream reports a failure, and no line re-arms anything.
    await vi.waitFor(() => expect(failed).toHaveBeenCalledOnce(), { timeout: 5_000 });
    expect(timeouts.mock.calls.length).toBe(armed);
  } finally {
    timeouts.mockRestore();
    stop?.();
    await rm(root, { recursive: true, force: true });
  }
});

it("writes nothing and arms no timer while the repository is quiet (ADR-0602)", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const lines: string[] = [];
  const notify: { local: () => void } = { local: () => undefined };
  vi.doMock("@lervo/repository-knowledge-runtime", async (original) => ({
    ...(await original<typeof import("@lervo/repository-knowledge-runtime")>()),
    watchRepositoryChanges: async (_root: string, changed: () => void) => {
      notify.local = changed;
      return () => undefined;
    },
  }));
  const { publishRepositoryChangeHints } = await import("../src/repository-replica-watch.js");
  const abort = new AbortController();
  const publishing = publishRepositoryChangeHints({
    root: "/fixture",
    signal: abort.signal,
    write: (line) => lines.push(line.trim()),
  });
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(24 * 60 * 60_000);
    expect(lines.map((line) => JSON.parse(line).status)).toEqual(["changed"]);
    expect(vi.getTimerCount()).toBe(0);
    notify.local();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(lines.map((line) => JSON.parse(line).status)).toEqual(["changed", "changed"]);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    abort.abort();
    await vi.advanceTimersByTimeAsync(1_000);
    await publishing;
    vi.doUnmock("@lervo/repository-knowledge-runtime");
    vi.useRealTimers();
  }
});

it("terminates a repository replica SSH command that exceeds its deadline", async () => {
  const root = await mkdtemp(join(tmpdir(), "lervo-peer-timeout-"));
  try {
    const script = join(root, "peer.mjs");
    const pidFile = join(root, "pid");
    await writeFile(
      script,
      'import { writeFileSync } from "node:fs"; writeFileSync(process.argv[2], String(process.pid)); setInterval(() => {}, 10000);',
    );
    const peer = new SshRepositoryReplicaPeer({
      executable: process.execPath,
      arguments: [script, pidFile],
      destination: "fixture",
      remoteNodeExecutable: "node",
      remoteRuntimeExecutable: "runtime",
      // Leave enough time for the child to publish its PID even when the full
      // repository test suite is saturating the process scheduler.
      commandTimeoutMs: 1_000,
    });
    await expect(peer.snapshot("/fixture")).rejects.toThrow(/execution deadline/u);
    const pid = Number(await readFile(pidFile, "utf8"));
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow());
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
