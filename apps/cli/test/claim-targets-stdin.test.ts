import { EventEmitter } from "node:events";
import { Writable } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

type Done = (error: Error | null, stdout: string) => void;

/**
 * A Git that has already exited when its input is written: the write fails with EPIPE, and the
 * process callback still reports the exit status and output.
 */
const childProcess = vi.hoisted(() => ({
  execFile: vi.fn((_command: string, _args: string[], _options: object, done: Done) => {
    const stdin = new Writable({
      write(_chunk, _encoding, callback) {
        callback(Object.assign(new Error("write EPIPE"), { code: "EPIPE", syscall: "write" }));
      },
    });
    setImmediate(() => done(null, "debug.log\0"));
    return Object.assign(new EventEmitter(), { stdin });
  }),
}));
vi.mock("node:child_process", () => childProcess);

const { unignoredClaimPaths } = await import("../src/claim-targets.js");

afterEach(() => childProcess.execFile.mockClear());

describe("claim target Git queries", () => {
  it("answer from the exit status when Git closes its input before the write", async () => {
    const paths = await unignoredClaimPaths("/checkout", [
      { path: "debug.log", kind: "file" },
      { path: "notes.md", kind: "file" },
    ]);
    expect(paths).toEqual(["notes.md"]);
    expect(childProcess.execFile).toHaveBeenCalledTimes(1);
  });
});
