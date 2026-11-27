import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * A child that has already exited when its stdin is written, as `lervo deliberate status` can be:
 * any write, even an empty one, fails with EPIPE, while closing stdin without data succeeds.
 */
const childProcess = vi.hoisted(() => ({
  spawn: vi.fn(() => {
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const stdin = new Writable({
      write(_chunk, _encoding, callback) {
        callback(Object.assign(new Error("write EPIPE"), { code: "EPIPE", syscall: "write" }));
      },
    });
    const child = Object.assign(new EventEmitter(), { stdout, stderr, stdin, kill: vi.fn() });
    setImmediate(() => {
      stdout.end('{"status":"converged"}\n');
      stderr.end();
      setImmediate(() => child.emit("close", 0));
    });
    return child;
  }),
}));
vi.mock("node:child_process", () => childProcess);

const { systemConversationDeliberationCliProcess } =
  await import("../src/conversation-deliberation-cli-executor.js");

afterEach(() => childProcess.spawn.mockClear());

describe("conversation deliberation CLI process stdin", () => {
  it("resolves a command with an empty request that exited before reading stdin", async () => {
    await expect(
      systemConversationDeliberationCliProcess.run({
        executable: "lervo",
        args: ["deliberate", "status"],
        stdin: "",
        timeoutMs: 5_000,
      }),
    ).resolves.toEqual({ exitCode: 0, stdout: '{"status":"converged"}\n', stderr: "" });
  });

  it("rejects a request that the command closed before reading", async () => {
    await expect(
      systemConversationDeliberationCliProcess.run({
        executable: "lervo",
        args: ["deliberate", "start"],
        stdin: '{"topic":"x"}',
        timeoutMs: 5_000,
      }),
    ).rejects.toThrow("did not read its whole request");
  });
});
