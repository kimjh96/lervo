import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  closeTerminalTurn,
  openTerminalTurn,
  singleOpenTerminalTurn,
  type OpenTerminalTurn,
} from "../src/terminal-open-turns.js";

const roots: string[] = [];
const now = new Date("2026-10-31T10:00:00.000Z");
const marker = (digit: string, openedAt = now.toISOString()): OpenTerminalTurn => ({
  provider: "claude",
  providerSessionDigest: `sha256:${digit.repeat(64)}`,
  providerTurnDigest: null,
  contextEventId: `evt_${digit.repeat(24)}`,
  openedAt,
});
async function root() {
  const path = await mkdtemp(resolve(tmpdir(), "lervo-open-turn-"));
  roots.push(path);
  return path;
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

it("binds only one open turn and removes only the closing marker", async () => {
  const path = await root();
  expect(await singleOpenTerminalTurn(path, now)).toBeNull();
  await openTerminalTurn(path, marker("a"));
  expect(await singleOpenTerminalTurn(path, now)).toEqual(marker("a"));
  await openTerminalTurn(path, marker("b"));
  expect(await singleOpenTerminalTurn(path, now)).toBeNull();
  await closeTerminalTurn(path, marker("a").contextEventId, now);
  expect(await singleOpenTerminalTurn(path, now)).toEqual(marker("b"));
  const directory = resolve(path, ".lervo/state/terminal-integration/open-turns");
  expect(await readdir(directory)).toEqual([`${marker("b").contextEventId}.json`]);
  expect(
    JSON.parse(await readFile(resolve(directory, `${marker("b").contextEventId}.json`), "utf8")),
  ).toEqual(marker("b"));
});

it("replaces an interrupted turn's marker when the same session opens a new turn", async () => {
  const path = await root();
  await openTerminalTurn(path, marker("a"));
  const next = { ...marker("a"), contextEventId: `evt_${"c".repeat(24)}` };
  await openTerminalTurn(path, next);
  expect(await singleOpenTerminalTurn(path, now)).toEqual(next);
  expect(await readdir(resolve(path, ".lervo/state/terminal-integration/open-turns"))).toEqual([
    `${next.contextEventId}.json`,
  ]);
});

it("expires markers older than six hours on the next hook and retains the exact boundary", async () => {
  const path = await root();
  const stale = marker("a", new Date(now.getTime() - 6 * 60 * 60 * 1000 - 1).toISOString());
  await openTerminalTurn(path, stale);
  await openTerminalTurn(path, marker("b"));
  expect(await singleOpenTerminalTurn(path, now)).toEqual(marker("b"));
  expect(await readdir(resolve(path, ".lervo/state/terminal-integration/open-turns"))).toEqual([
    `${marker("b").contextEventId}.json`,
  ]);
  await closeTerminalTurn(path, marker("b").contextEventId, now);
  const exact = marker("c", new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString());
  await openTerminalTurn(path, exact);
  expect(await singleOpenTerminalTurn(path, now)).toEqual(exact);
});

it("treats unreadable, malformed and symlinked marker storage as no binding", async () => {
  const path = await root();
  await openTerminalTurn(path, marker("a"));
  const directory = resolve(path, ".lervo/state/terminal-integration/open-turns");
  await writeFile(resolve(directory, `${marker("b").contextEventId}.json`), "malformed");
  expect(await singleOpenTerminalTurn(path, now)).toBeNull();
  await rm(directory, { recursive: true });
  await writeFile(directory, "unreadable directory");
  expect(await singleOpenTerminalTurn(path, now)).toBeNull();
  await rm(directory);
  const outside = await root();
  await symlink(outside, directory);
  await openTerminalTurn(path, marker("a"));
  expect(await singleOpenTerminalTurn(path, now)).toBeNull();
  expect(await readdir(outside)).toEqual([]);
});
