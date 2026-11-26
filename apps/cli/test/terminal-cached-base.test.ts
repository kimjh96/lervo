import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import { validateSchema } from "@lervo/schemas";
import {
  answeredFromCachedBaseSince,
  terminalCachedBaseNameDigest,
} from "../src/terminal-cached-base-turn.js";
import {
  formatTerminalCachedBase,
  keepTerminalCachedBase,
  terminalCachedBaseKey,
  type TerminalCachedBasePorts,
} from "../src/terminal-cached-base.js";

const cleanups: string[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const environment = {
  CLAUDE_CONFIG_DIR: null,
  CODEX_HOME: null,
  HOME: "/home/owner",
  LERVO_USER_CAPABILITY_ROOT: null,
  LERVO_USER_STATE_DIRECTORY: null,
  LERVO_WORKSPACES_HOME: null,
  XDG_CONFIG_HOME: null,
  XDG_STATE_HOME: null,
};
const args = ["--provider", "claude", "--contract", "2"];
const lines = [
  "Read AGENTS.md.",
  "Repository publication policy: en.",
  "Applied owner rules: complete; 1 complete clauses prepared; provider delivery unobserved.",
  "Owner rule: be brief.",
];

async function store() {
  const path = await mkdtemp(resolve(tmpdir(), "lervo-cached-base-"));
  cleanups.push(path);
  return path;
}

function ports(overrides: Partial<TerminalCachedBasePorts> = {}) {
  const append = vi.fn();
  const storage = {
    writableEventSchemaVersion: 14,
    manifest: { projectId: "prj_cached_base_01" },
    events: {
      transact: (work: (transaction: { append: typeof append }) => void) => work({ append }),
      get: (eventId: string) =>
        append.mock.calls.some(([event]) => event.eventId === eventId) ? {} : null,
    },
    close: vi.fn(async () => undefined),
  };
  const value: TerminalCachedBasePorts = {
    roots: async () => ({ evidenceRoot: "/repository", executionRoot: "/repository" }),
    claimed: async () => false,
    prepare: vi.fn(async () => ({ lines, abandoned: false })),
    openStorage: async () => storage as never,
    ...overrides,
  };
  return { value, append, storage };
}

const keep = (path: string, value: TerminalCachedBasePorts, now = Date.now) =>
  keepTerminalCachedBase({ store: path, cwd: "/repository", args, environment, now, ports: value });

it("writes the base as the prompt answer the launcher prints, owner-only", async () => {
  const path = await store();
  const { value } = ports();
  expect(await keep(path, value)).toEqual({ recorded: 0, refreshed: true, settled: true });
  const file = resolve(
    path,
    "base",
    `${terminalCachedBaseKey("/repository", args, environment)}.json`,
  );
  const answer = JSON.parse(await readFile(file, "utf8"));
  expect(answer.hookSpecificOutput.hookEventName).toBe("UserPromptSubmit");
  const context: string = answer.hookSpecificOutput.additionalContext;
  expect(context.startsWith("Read AGENTS.md.\n\nLervo cached base context, prepared ")).toBe(true);
  expect(context).toContain("Owner rule: be brief.");
  if (process.platform !== "win32") expect((await stat(file)).mode & 0o077).toBe(0);
});

it("refreshes a base only once it is five minutes old", async () => {
  const path = await store();
  const { value } = ports();
  await keep(path, value);
  expect((await keep(path, value)).refreshed).toBe(false);
  expect((await keep(path, value, () => Date.now() + 5 * 60_000 + 1000)).refreshed).toBe(true);
  expect(value.prepare).toHaveBeenCalledTimes(2);
});

it("keeps no base for a checkout a workspace claims, and removes one found there", async () => {
  const path = await store();
  await keep(path, ports().value);
  const { value } = ports({ claimed: async () => true });
  // The claim is checked when the base is due for a refresh.
  expect(await keep(path, value, () => Date.now() + 5 * 60_000 + 1000)).toEqual({
    recorded: 0,
    refreshed: false,
    settled: true,
  });
  expect((await readdir(resolve(path, "base"))).filter((name) => name.endsWith(".json"))).toEqual(
    [],
  );
  expect(value.prepare).not.toHaveBeenCalled();
});

it("writes no base when the owner rules did not load, so the next prompt retries", async () => {
  const path = await store();
  const { value } = ports({
    prepare: vi.fn(async () => ({
      lines: ["Read AGENTS.md.", "Repository publication policy: en."],
      abandoned: false,
    })),
  });
  expect((await keep(path, value)).refreshed).toBe(false);
  expect((await readdir(resolve(path, "base"))).filter((name) => name.endsWith(".json"))).toEqual(
    [],
  );
  // A store too slow for a base waits five minutes before the next attempt.
  await keep(path, value);
  expect(value.prepare).toHaveBeenCalledTimes(1);
  await keep(path, value, () => Date.now() + 5 * 60_000 + 1000);
  expect(value.prepare).toHaveBeenCalledTimes(2);
});

it("refreshes the base even when the store cannot record deliveries", async () => {
  const path = await store();
  const directory = resolve(path, "base");
  await mkdir(directory, { recursive: true });
  const key = terminalCachedBaseKey("/repository", args, environment);
  await writeFile(
    resolve(directory, `${key}.${Date.now()}.41.unserved`),
    '{"reason":"no_server","age":5}',
  );
  const { value } = ports({
    openStorage: async () => {
      throw new Error("database is locked");
    },
  });
  expect(await keep(path, value)).toEqual({ recorded: 0, refreshed: true, settled: true });
  // The delivery waits for a store that can record it, and is then recorded once.
  const { value: later, append } = ports();
  await rm(resolve(directory, `${key}.json`));
  expect((await keep(path, later)).recorded).toBe(1);
  expect(append).toHaveBeenCalledTimes(1);
});

it("never records a delivery twice when its marker survived", async () => {
  const path = await store();
  const directory = resolve(path, "base");
  await mkdir(directory, { recursive: true });
  const key = terminalCachedBaseKey("/repository", args, environment);
  const marker = resolve(directory, `${key}.${Date.now()}.41.unserved`);
  const content = '{"reason":"no_server","age":5}';
  await writeFile(marker, content);
  const { value, append } = ports();
  expect((await keep(path, value)).recorded).toBe(1);
  // As if removing it had failed after the record.
  await writeFile(marker, content);
  await rm(resolve(directory, `${key}.json`));
  expect((await keep(path, value)).recorded).toBe(0);
  expect(append).toHaveBeenCalledTimes(1);
});

it("leaves a marker the launcher may still be writing, and sweeps day-old files", async () => {
  const path = await store();
  const directory = resolve(path, "base");
  await mkdir(directory, { recursive: true });
  const key = terminalCachedBaseKey("/repository", args, environment);
  const young = `${key}.${Date.now()}.41.unserved`;
  await writeFile(resolve(directory, young), "");
  const removed = `${"1".repeat(16)}.json`;
  await writeFile(resolve(directory, removed), "{}\n");
  const day = new Date(Date.now() - 25 * 60 * 60_000);
  await utimes(resolve(directory, removed), day, day);
  const { value, append } = ports();
  await keep(path, value);
  expect(append).not.toHaveBeenCalled();
  const names = await readdir(directory);
  expect(names).toContain(young);
  expect(names).not.toContain(removed);
});

it("records the checkout's markers at schema 14 and drops bad or foreign ones", async () => {
  const path = await store();
  const directory = resolve(path, "base");
  await mkdir(directory, { recursive: true });
  const key = terminalCachedBaseKey("/repository", args, environment);
  const at = Date.now() - 1000;
  await writeFile(
    resolve(directory, `${key}.${at}.41.unserved`),
    '{"reason":"declined_busy","age":4100}',
  );
  await writeFile(
    resolve(directory, `${key}.${at + 1}.42.unserved`),
    '{"reason":"runtime_mismatch","age":1}',
  );
  await writeFile(
    resolve(directory, `${key}.${at + 2}.43.unserved`),
    '{"reason":"no_server","age":1800001}',
  );
  const old = Date.now() - 25 * 60 * 60_000;
  await writeFile(
    resolve(directory, `${key}.${old}.44.unserved`),
    '{"reason":"no_server","age":5}',
  );
  const other = `${"0".repeat(16)}.${at}.45.unserved`;
  await writeFile(resolve(directory, other), '{"reason":"no_server","age":5}');
  const { value, append } = ports();
  expect((await keep(path, value)).recorded).toBe(1);
  const event = append.mock.calls[0]![0];
  expect(event).toMatchObject({
    type: "terminal.context.base_delivered",
    schemaVersion: 14,
    actor: { kind: "system" },
    payload: {
      reason: "declined_busy",
      cacheAgeMilliseconds: 4100,
      deliveredAt: new Date(at).toISOString(),
    },
  });
  expect(validateSchema("terminalContextBaseDeliveredEventPayload", event.payload).valid).toBe(
    true,
  );
  expect(event.runId).toMatch(/^run_basedelivery_[a-f0-9]{32}$/u);
  expect((await readdir(directory)).filter((name) => name.endsWith(".unserved"))).toEqual([other]);
});

it("removes markers unrecorded below writer schema 14", async () => {
  const path = await store();
  const directory = resolve(path, "base");
  await mkdir(directory, { recursive: true });
  const key = terminalCachedBaseKey("/repository", args, environment);
  await writeFile(
    resolve(directory, `${key}.${Date.now()}.41.unserved`),
    '{"reason":"no_server","age":5}',
  );
  const { value, append, storage } = ports();
  storage.writableEventSchemaVersion = 13;
  expect((await keep(path, value)).recorded).toBe(0);
  expect(append).not.toHaveBeenCalled();
  expect((await readdir(directory)).filter((name) => name.endsWith(".unserved"))).toEqual([]);
});

it("names a different base for a session whose compared variables differ", () => {
  const key = terminalCachedBaseKey("/repository", args, environment);
  expect(
    terminalCachedBaseKey("/repository", args, { ...environment, XDG_STATE_HOME: "/s" }),
  ).not.toBe(key);
  expect(terminalCachedBaseKey("/repository", ["--provider", "codex"], environment)).not.toBe(key);
  // An empty variable is not an unset one.
  expect(
    terminalCachedBaseKey("/repository", args, { ...environment, XDG_STATE_HOME: "" }),
  ).not.toBe(key);
});

it("tells a Stop when the session's latest prompt was answered from the cached base", async () => {
  const directory = await store();
  const since = Date.now() - 60_000;
  expect(await answeredFromCachedBaseSince("session-1", since, directory)).toBe(false);
  const marker = resolve(directory, `${terminalCachedBaseNameDigest("session-1")}.turn`);
  await writeFile(marker, "");
  expect(await answeredFromCachedBaseSince("session-1", since, directory)).toBe(true);
  expect(await answeredFromCachedBaseSince("session-2", since, directory)).toBe(false);
  // A later prepared context means the session's newer prompt was served and recorded.
  const earlier = new Date(since - 60_000);
  await utimes(marker, earlier, earlier);
  expect(await answeredFromCachedBaseSince("session-1", since, directory)).toBe(false);
});

it("caps the cached context like any compact context", () => {
  const long = ["Read AGENTS.md.", "x".repeat(10_000)];
  const answer = JSON.parse(formatTerminalCachedBase(long, new Date(0)));
  expect(Buffer.byteLength(answer.hookSpecificOutput.additionalContext)).toBeLessThanOrEqual(4096);
});

it("reports work it left running when preparation reached its deadline", async () => {
  const path = await store();
  const { value } = ports({
    prepare: async () => ({ lines: ["Read AGENTS.md."], abandoned: true }),
  });
  expect(await keep(path, value)).toEqual({ recorded: 0, refreshed: false, settled: false });
});

it("does nothing more while the base is fresh and no delivery waits", async () => {
  const path = await store();
  await keep(path, ports().value);
  const roots = vi.fn(async () => ({ evidenceRoot: "/repository", executionRoot: "/repository" }));
  expect((await keep(path, ports({ roots }).value)).refreshed).toBe(false);
  expect(roots).not.toHaveBeenCalled();
});
