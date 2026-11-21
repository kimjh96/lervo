import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

/** Each connection this file makes fails with the next scripted error code. */
const failures: string[] = [];
vi.mock("node:net", async (original) => {
  const actual = await original<typeof import("node:net")>();
  return {
    ...actual,
    connect: () => {
      const socket = Object.assign(new EventEmitter(), {
        unref: () => socket,
        destroy: () => undefined,
      });
      const code = failures.shift() ?? "EMFILE";
      setImmediate(() => {
        socket.emit("error", Object.assign(new Error(code), { code }));
        socket.emit("close", true);
      });
      return socket;
    },
  };
});

const { holdProcessPresence, waitForProcessExit } = await import("../src/process-presence.js");

const roots: string[] = [];
afterEach(async () => {
  failures.length = 0;
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** A token of this host, boot and namespace for `directory`, as a holder there writes it. */
async function token(): Promise<{ token: string; directory: string }> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-reset-"));
  roots.push(root);
  const directory = resolve(root, "p");
  const held = holdProcessPresence({ directory });
  await held.ready;
  held.release();
  return { token: held.token, directory };
}

it.skipIf(process.platform === "win32")(
  "ends an exit wait at once on a reset connection, which Linux gives a pending one at release",
  async () => {
    const { token: holder, directory } = await token();
    for (const code of ["ECONNRESET", "EPIPE"]) {
      failures.push(code);
      const exited = vi.fn();
      const issues: (string | null)[] = [];
      waitForProcessExit(holder, exited, { directory, onIssue: (issue) => issues.push(issue) });
      await vi.waitFor(() => expect(exited).toHaveBeenCalledOnce(), { timeout: 500 });
      expect(issues).toEqual([]);
    }
  },
);

it.skipIf(process.platform === "win32")(
  "retries an error that proves nothing with backoff and attention, never as an exit",
  async () => {
    const { token: holder, directory } = await token();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    failures.push("EMFILE", "EAGAIN", "ENOENT");
    const exited = vi.fn();
    const issues: (string | null)[] = [];
    waitForProcessExit(holder, exited, { directory, onIssue: (issue) => issues.push(issue) });
    await new Promise((settle) => setImmediate(settle));
    expect(exited).not.toHaveBeenCalled();
    expect(issues).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await new Promise((settle) => setImmediate(settle));
    expect(exited).not.toHaveBeenCalled();
    expect(issues).toHaveLength(2);
    // The socket is gone at the third attempt, two seconds later.
    await vi.advanceTimersByTimeAsync(2_000);
    await new Promise((settle) => setImmediate(settle));
    expect(exited).toHaveBeenCalledOnce();
  },
);
