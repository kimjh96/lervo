import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

import { terminalContextWarmth } from "../src/terminal-context-warmth.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function directory() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-warmth-"));
  roots.push(root);
  return root;
}

const settle = () => new Promise((done) => setTimeout(done, 60));

it("remembers the latest four checkouts, owner-only, and warms them first after a restart", async () => {
  const root = await directory();
  const file = resolve(root, "context-warmth.json");
  const first = terminalContextWarmth({ busy: () => false, warm: async () => undefined, file });
  for (const cwd of ["/a", "/b", "/c", "/d", "/e", "/b"]) first.served(cwd);
  await settle();
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
    schemaVersion: 1,
    checkouts: ["/c", "/d", "/e", "/b"],
  });
  expect((await stat(file)).mode & 0o777).toBe(0o600);
  const warmed: string[] = [];
  const restarted = terminalContextWarmth({
    busy: () => false,
    warm: async (cwd) => void warmed.push(cwd),
    file,
    intervalMs: 3_600_000,
  });
  await restarted.start();
  restarted.stop();
  // The most recent first, so the checkout in use is warm soonest.
  expect(warmed).toEqual(["/b", "/e", "/d", "/c"]);
});

it("warms the latest checkout while idle, never while a request holds the server", async () => {
  const root = await directory();
  let busy = true;
  const warmed: string[] = [];
  const warmth = terminalContextWarmth({
    busy: () => busy,
    warm: async (cwd) => void warmed.push(cwd),
    file: resolve(root, "context-warmth.json"),
    intervalMs: 10,
  });
  await warmth.start();
  warmth.served("/repository");
  await settle();
  expect(warmed).toEqual([]);
  busy = false;
  await settle();
  warmth.stop();
  expect(warmed.length).toBeGreaterThan(0);
  expect(new Set(warmed)).toEqual(new Set(["/repository"]));
});

it("lets a checkout go cold half an hour after its last request, and survives a failing warm", async () => {
  const root = await directory();
  let clock = 0;
  const warmed: string[] = [];
  const warmth = terminalContextWarmth({
    busy: () => false,
    warm: async (cwd) => {
      warmed.push(cwd);
      throw new Error("cannot prepare");
    },
    file: resolve(root, "context-warmth.json"),
    now: () => clock,
    intervalMs: 10,
  });
  await warmth.start();
  warmth.served("/old");
  await settle();
  expect(warmed.length).toBeGreaterThan(0);
  clock += 30 * 60_000 + 1;
  warmed.length = 0;
  await settle();
  warmth.stop();
  expect(warmed).toEqual([]);
});

it("starts with nothing remembered when the file is missing or malformed", async () => {
  const root = await directory();
  const file = resolve(root, "context-warmth.json");
  await writeFile(file, "{not json");
  const warmed: string[] = [];
  const warmth = terminalContextWarmth({
    busy: () => false,
    warm: async (cwd) => void warmed.push(cwd),
    file,
    intervalMs: 3_600_000,
  });
  await warmth.start();
  warmth.stop();
  expect(warmed).toEqual([]);
});
