import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readdir, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, expect, it, vi } from "vitest";

import { localBootKey, localHostKey } from "../src/process-identity.js";
import {
  holdProcessPresence,
  ownedPresenceDirectory,
  probeProcessPresence,
  processPresenceDirectory,
  waitForProcessExit,
  connectionVerdict,
  wakeProcessPresence,
} from "../src/process-presence.js";

const hooks = resolve(import.meta.dirname, "support/register-workspace-source.mjs");
const source = resolve(import.meta.dirname, "../src/process-presence.ts");
const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function presenceDirectory() {
  // Short, so the socket path stays under the platform limit.
  const path = await mkdtemp(join(process.platform === "win32" ? tmpdir() : "/tmp", "lp-"));
  directories.push(path);
  return path;
}

/** A child that holds its presence, prints its token, and prints `wake` for every wake. */
function holder(directory: string) {
  const child = spawn(
    process.execPath,
    [
      "--import",
      pathToFileURL(hooks).href,
      "--input-type=module",
      "-e",
      `const { holdProcessPresence } = await import(process.argv[1]);
       const held = holdProcessPresence({ directory: process.argv[2], onWake: () => process.stdout.write("wake\\n") });
       await held.ready;
       process.stdout.write(held.token + "\\n");
       setInterval(() => {}, 1 << 30);`,
      pathToFileURL(source).href,
      directory,
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const lines: string[] = [];
  child.stdout.on("data", (chunk: Buffer) => lines.push(...chunk.toString().trim().split("\n")));
  return { child, lines };
}

it(
  "proves a holder alive, wakes it, and sees its death through a held connection with no timer (ADR-0602)",
  { timeout: 30_000 },
  async () => {
    const directory = await presenceDirectory();
    const { child, lines } = holder(directory);
    try {
      await vi.waitFor(() => expect(lines.length).toBeGreaterThan(0), { timeout: 15_000 });
      const token = lines[0]!;
      expect(await probeProcessPresence(token, { directory })).toBe("alive");
      expect(await wakeProcessPresence(token, { directory })).toBe(true);
      await vi.waitFor(() => expect(lines).toContain("wake"));
      const exited = vi.fn();
      const timeouts = vi.spyOn(globalThis, "setTimeout");
      const cancel = waitForProcessExit(token, exited, { directory });
      expect(timeouts).not.toHaveBeenCalled();
      timeouts.mockRestore();
      await new Promise((settle) => setTimeout(settle, 200));
      expect(exited).not.toHaveBeenCalled();
      child.kill("SIGKILL");
      await vi.waitFor(() => expect(exited).toHaveBeenCalledOnce(), { timeout: 5_000 });
      cancel();
      expect(await probeProcessPresence(token, { directory })).toBe("gone");
      // The probe that proved it gone removed the dead socket.
      if (process.platform !== "win32") expect(await readdir(directory)).toEqual([]);
      expect(await wakeProcessPresence(token, { directory })).toBe(false);
    } finally {
      child.kill("SIGKILL");
    }
  },
);

it("sees a release at once and judges other boots and malformed tokens", async () => {
  const directory = await presenceDirectory();
  const held = holdProcessPresence({ directory });
  await held.ready;
  expect(held.issue()).toBeNull();
  expect(await probeProcessPresence(held.token, { directory })).toBe("alive");
  const exited = vi.fn();
  waitForProcessExit(held.token, exited, { directory });
  await new Promise((settle) => setTimeout(settle, 100));
  held.release();
  await vi.waitFor(() => expect(exited).toHaveBeenCalledOnce());
  expect(await probeProcessPresence(held.token, { directory })).toBe("gone");
  const boot = localBootKey();
  const otherBoot = boot.startsWith("b")
    ? `b${"0".repeat(12)}`
    : `t${Number(boot.slice(1)) - 86_400}`;
  const namespace = held.token.split("-").at(-1)!;
  expect(
    await probeProcessPresence(`${localHostKey()}-${otherBoot}-1-${"a".repeat(16)}-${namespace}`, {
      directory,
    }),
  ).toBe("gone");
  // Another host: unknown. (On Linux a token with this boot id is this kernel whatever its host
  // key, as a container's is, so the other host has another boot too.)
  expect(
    await probeProcessPresence(`aaaaaaaaaaaa-${otherBoot}-1-${"a".repeat(16)}-${namespace}`, {
      directory,
    }),
  ).toBe("unknown");
  // Another namespace or presence directory cannot be reached from here: unknown, never gone.
  expect(
    await probeProcessPresence(`${localHostKey()}-${boot}-1-${"a".repeat(16)}-${"0".repeat(12)}`, {
      directory,
    }),
  ).toBe("unknown");
  expect(await probeProcessPresence("not a token", { directory })).toBe("unknown");
});

it("holds the default presence in a place every process of this user finds", async () => {
  const held = holdProcessPresence();
  await held.ready;
  expect(held.issue()).toBeNull();
  expect(await probeProcessPresence(held.token)).toBe("alive");
  held.release();
  await vi.waitFor(async () => expect(await probeProcessPresence(held.token)).toBe("gone"));
});

it("keeps the default directory short enough for a socket path, however deep the state root", () => {
  const saved = process.env.LERVO_USER_STATE_DIRECTORY;
  process.env.LERVO_USER_STATE_DIRECTORY = `/${"deep/".repeat(30)}state`;
  try {
    const directory = processPresenceDirectory();
    expect(Buffer.byteLength(`${directory}/${"0".repeat(16)}.s`)).toBeLessThanOrEqual(100);
    expect(directory).not.toContain("/tmp/");
  } finally {
    if (saved === undefined) delete process.env.LERVO_USER_STATE_DIRECTORY;
    else process.env.LERVO_USER_STATE_DIRECTORY = saved;
  }
});

it.skipIf(process.platform === "win32")(
  "keeps a fallback directory after its last presence is released, so its inode stays its name",
  async () => {
    const saved = process.env.LERVO_USER_STATE_DIRECTORY;
    process.env.LERVO_USER_STATE_DIRECTORY = `/${"deep/".repeat(30)}state-${process.pid}`;
    const directory = processPresenceDirectory();
    try {
      const first = holdProcessPresence();
      await first.ready;
      expect(first.issue()).toBeNull();
      first.release();
      await vi.waitFor(async () => expect(await probeProcessPresence(first.token)).toBe("gone"));
      // A removed and recreated directory would have another inode, and every earlier token would
      // then read unknown rather than gone; it stays, and a later presence names it the same way.
      expect(await readdir(directory)).toEqual([]);
      const second = holdProcessPresence();
      await second.ready;
      expect(second.token.split("-").at(-1)).toBe(first.token.split("-").at(-1));
      second.release();
    } finally {
      if (saved === undefined) delete process.env.LERVO_USER_STATE_DIRECTORY;
      else process.env.LERVO_USER_STATE_DIRECTORY = saved;
      await rm(directory, { recursive: true, force: true });
    }
  },
);

it.skipIf(process.platform === "win32")("reports a presence it cannot hold", async () => {
  const held = holdProcessPresence({ directory: `/tmp/${"x".repeat(120)}` });
  await held.ready;
  expect(held.issue()).toContain("longer than a local socket path");
  // Its token is never recorded; probed anyway, it is never alive.
  expect(await probeProcessPresence(held.token, { directory: "/tmp" })).not.toBe("alive");
  held.release();
});

it.skipIf(process.platform === "win32")(
  "refuses a presence directory others can enter or another user owns",
  async () => {
    const open = await presenceDirectory();
    await chmod(open, 0o755);
    expect(ownedPresenceDirectory(open)).toContain("no one else can enter");
    const shared = holdProcessPresence({ directory: open });
    await shared.ready;
    expect(shared.issue()).toContain("no one else can enter");
    shared.release();
    // A directory of another user (root's /usr) is never used.
    expect(ownedPresenceDirectory("/usr")).not.toBeNull();
  },
);

it.skipIf(process.platform === "win32")(
  "reads a refused connection from a live pid as alive only where a full backlog also refuses",
  { timeout: 30_000 },
  async () => {
    const directory = await presenceDirectory();
    const { child, lines } = holder(directory);
    await vi.waitFor(() => expect(lines.length).toBeGreaterThan(0), { timeout: 15_000 });
    const token = lines[0]!;
    child.kill("SIGKILL");
    await new Promise((settle) => child.once("exit", settle));
    // The dead holder left its socket file. Its pid is given to this live process, as a reused pid.
    const [host, boot, , nonce, namespace] = token.split("-");
    const reused = `${host}-${boot}-${process.pid}-${nonce}-${namespace}`;
    if (process.platform === "linux") {
      // A full backlog answers EAGAIN on Linux, so a refusal proves the listener is gone.
      expect(await probeProcessPresence(reused, { directory })).toBe("gone");
      expect(await readdir(directory)).toEqual([]);
      return;
    }
    expect(await probeProcessPresence(reused, { directory })).toBe("alive");
    expect(await readdir(directory)).toEqual([`${nonce}.s`]);
    // An exit wait on it keeps looking, and reports refusals that last.
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const issues: (string | null)[] = [];
    const cancel = waitForProcessExit(reused, () => issues.push("exit"), {
      directory,
      onIssue: (issue) => issues.push(issue),
    });
    try {
      // Each refusal is real I/O; each retry delay (one second, doubling) is a fake timer.
      for (let step = 0; step < 200 && issues.length === 0; step++) {
        for (let turn = 0; turn < 10; turn++) await new Promise((settle) => setImmediate(settle));
        await vi.advanceTimersByTimeAsync(60_000);
      }
      expect(issues[0]).toContain("keeps refusing connections");
      expect(issues).not.toContain("exit");
    } finally {
      cancel();
      vi.useRealTimers();
    }
    expect(await probeProcessPresence(token, { directory })).toBe("gone");
    expect(await readdir(directory)).toEqual([]);
  },
);

it("classifies a failed connection for Linux and macOS alike", () => {
  const verdicts = (platform: NodeJS.Platform, lives: boolean) =>
    ["ENOENT", "ECONNRESET", "EPIPE", "ECONNREFUSED", "EMFILE", "EAGAIN", undefined].map((code) =>
      connectionVerdict(code, platform, () => lives),
    );
  // Linux: a full backlog answers EAGAIN, so a refusal proves the listener is gone.
  expect(verdicts("linux", true)).toEqual([
    "gone",
    "gone",
    "gone",
    "gone",
    "unknown",
    "unknown",
    "unknown",
  ]);
  // macOS: a full backlog refuses too, so a refusal from a live pid is still alive.
  expect(verdicts("darwin", true)).toEqual([
    "gone",
    "gone",
    "gone",
    "alive",
    "unknown",
    "unknown",
    "unknown",
  ]);
  expect(verdicts("darwin", false)[3]).toBe("gone");
});

it.skipIf(process.platform === "win32")(
  "names its directory by device and inode, so another directory at the same path is unknown",
  async () => {
    const root = await presenceDirectory();
    try {
      const first = resolve(root, "a");
      const held = holdProcessPresence({ directory: first });
      await held.ready;
      expect(held.issue()).toBeNull();
      // The same directory under another path (a bind mount, a rename) is the same place.
      const moved = resolve(root, "b");
      await rename(first, moved);
      expect(await probeProcessPresence(held.token, { directory: moved })).toBe("alive");
      // Another directory at the original path, as a container with its own filesystem sees it:
      // the socket is missing there, yet the holder is not gone, only out of reach.
      await mkdir(first, { mode: 0o700 });
      expect(await probeProcessPresence(held.token, { directory: first })).toBe("unknown");
      const exited = vi.fn();
      const issues: (string | null)[] = [];
      const cancel = waitForProcessExit(held.token, exited, {
        directory: first,
        onIssue: (issue) => issues.push(issue),
      });
      expect(exited).not.toHaveBeenCalled();
      expect(issues[0]).toContain("cannot be judged");
      cancel();
      held.release();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
