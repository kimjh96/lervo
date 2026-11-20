import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { afterEach, expect, it, vi } from "vitest";

import { localBootKey, localHostKey } from "../src/process-identity.js";
import {
  holdProcessPresence,
  probeProcessPresence,
  processPresenceDirectory,
  waitForProcessExit,
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
  expect(
    await probeProcessPresence(`${localHostKey()}-${otherBoot}-1-${"a".repeat(16)}`, {
      directory,
    }),
  ).toBe("gone");
  expect(
    await probeProcessPresence(`aaaaaaaaaaaa-${boot}-1-${"a".repeat(16)}`, { directory }),
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

it.skipIf(process.platform === "win32")("reports a presence it cannot hold", async () => {
  const held = holdProcessPresence({ directory: `/tmp/${"x".repeat(120)}` });
  await held.ready;
  expect(held.issue()).toContain("longer than a local socket path");
  expect(await probeProcessPresence(held.token, { directory: "/tmp" })).toBe("gone");
  held.release();
});
