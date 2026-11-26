import { spawn } from "node:child_process";
import { createServer, type Server, type Socket } from "node:net";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { TERMINAL_CONTEXT_ENVIRONMENT } from "../src/terminal-context-server.js";
import { TERMINAL_CONTEXT_SESSION_NAMES } from "../src/terminal-context-session.js";
import { inProcessHookFallback } from "../src/terminal-hook-delivery.js";
import { terminalCachedBaseKey } from "../src/terminal-cached-base.js";
import { answeredFromCachedBaseSince } from "../src/terminal-cached-base-turn.js";
import {
  materializeHostTerminalRuntime,
  terminalHookRuntimeStorePath,
} from "@lervo/repository-knowledge";

const source = fileURLToPath(new URL("../src/terminal-hook-launcher.mjs", import.meta.url));
// The fixture runtime echoes its input, so a fallback is visible in the output.
const runtimeContent =
  '#!/usr/bin/env node\nprocess.stdin.on("data", c => process.stdout.write(c));\n';
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function fixture(runtime = runtimeContent) {
  // Short: the store holds a Unix socket, whose path is limited to about a hundred bytes.
  const home = await realpath(await mkdtemp(resolve(tmpdir(), "lvl-")));
  const cwd = resolve(home, "repository");
  await mkdir(cwd, { recursive: true });
  const environment: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home };
  delete environment.LERVO_TERMINAL_CONTEXT_SOCKET;
  const store = terminalHookRuntimeStorePath(environment, process.platform, home);
  await materializeHostTerminalRuntime({ store, runtimeContent: runtime, assets: [] });
  cleanups.push(() => rm(home, { recursive: true, force: true }));
  return { home, cwd, environment, store };
}

/** A context server stand-in at the store's socket that answers each request with `respond`. */
async function listen(
  store: string,
  respond: (socket: Socket, request: Record<string, unknown>) => void,
): Promise<{ requests: Record<string, unknown>[] }> {
  const requests: Record<string, unknown>[] = [];
  const server: Server = createServer((socket) => {
    let buffered = "";
    socket.on("data", (chunk) => {
      buffered += chunk.toString();
      const end = buffered.indexOf("\n");
      if (end === -1 || requests.length > 0) return;
      const request = JSON.parse(buffered.slice(0, end)) as Record<string, unknown>;
      requests.push(request);
      respond(socket, request);
    });
  });
  await new Promise<void>((done) => server.listen(resolve(store, "context.s"), done));
  cleanups.push(() => new Promise<void>((done) => server.close(() => done())));
  return { requests };
}

function launch(f: Awaited<ReturnType<typeof fixture>>, input: string, extra = {}) {
  const child = spawn(process.execPath, [source, "--provider", "claude", "--contract", "2"], {
    cwd: f.cwd,
    env: { ...f.environment, ...extra },
    stdio: "pipe",
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
  child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
  child.stdin.end(input);
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((done) =>
    child.once("close", (code) => done({ code, stdout, stderr })),
  );
}

const prompt = JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "fix the form" });

function commitThen(answer: object | null) {
  return (socket: Socket) => {
    socket.write("A");
    socket.once("data", (chunk) => {
      expect(chunk.toString()).toBe("G");
      if (answer === null) socket.destroy();
      else socket.end(`${JSON.stringify(answer)}\n`);
    });
  };
}

it("prints the server's answer without loading the runtime", async () => {
  const f = await fixture();
  const pointer = JSON.parse(await readFile(resolve(f.store, "current.json"), "utf8"));
  const server = await listen(
    f.store,
    commitThen({ ok: true, stdout: "served\n", stderr: "notice\n", exitCode: 0 }),
  );
  expect(await launch(f, prompt)).toEqual({ code: 0, stdout: "served\n", stderr: "notice\n" });
  expect(server.requests).toHaveLength(1);
  expect(server.requests[0]).toMatchObject({
    version: 1,
    kind: "prompt",
    runtime: pointer.contentHash,
    cwd: f.cwd,
    args: ["--provider", "claude", "--contract", "2"],
    input: prompt,
  });
  expect(Object.keys(server.requests[0]!.environment as object).sort()).toEqual([
    "CLAUDE_CONFIG_DIR",
    "CODEX_HOME",
    "HOME",
    "LERVO_USER_CAPABILITY_ROOT",
    "LERVO_USER_STATE_DIRECTORY",
    "LERVO_WORKSPACES_HOME",
    "XDG_CONFIG_HOME",
    "XDG_STATE_HOME",
  ]);
});

it("falls back with the same input when the server declines", async () => {
  const f = await fixture();
  await listen(f.store, (socket) => socket.end(`${JSON.stringify({ declined: "busy" })}\n`));
  expect(await launch(f, prompt)).toEqual({ code: 0, stdout: prompt, stderr: "" });
});

// This fixture runtime prints what the launcher left about its offer (schema 13 `delivery`).
const offerRuntime =
  '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify(globalThis[Symbol.for("lervo.terminalHook.offer")] ?? null));\n';

async function fallbackAfter(
  setup: (f: Awaited<ReturnType<typeof fixture>>) => Promise<unknown>,
  input = prompt,
) {
  const f = await fixture(offerRuntime);
  await setup(f);
  const result = await launch(f, input);
  expect(result.code).toBe(0);
  return inProcessHookFallback(JSON.parse(result.stdout), f.environment, process.platform);
}

it.skipIf(process.platform === "win32")(
  "leaves the runtime why a hook was not served",
  async () => {
    expect(
      await fallbackAfter((f) =>
        listen(f.store, (socket) => socket.end(`${JSON.stringify({ declined: "busy" })}\n`)),
      ),
    ).toBe("declined_busy");
    expect(await fallbackAfter(async () => undefined)).toBe("no_server");
    // Accepted but never answered: the launcher gives up before the commit.
    expect(await fallbackAfter((f) => listen(f.store, () => undefined))).toBe("unreachable");
    // An input the launcher never offers.
    expect(
      await fallbackAfter(
        (f) => listen(f.store, commitThen({ ok: true, stdout: "", exitCode: 0 })),
        JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "x".repeat(210 * 1024) }),
      ),
    ).toBe("not_offered");
  },
);

it("sends a Stop with the session's values, and starts the launches the answer names", async () => {
  const f = await fixture();
  // A launch writes its argument and two of its variables, showing it ran in this session.
  const worker = resolve(f.home, "worker.mjs");
  await writeFile(
    worker,
    'import { writeFileSync } from "node:fs";\n' +
      "writeFileSync(process.argv[2], JSON.stringify({ runtime: process.env.LERVO_TERMINAL_HOOK_RUNTIME, marker: process.env.LERVO_TEST_SESSION_MARKER }));\n",
  );
  const written = resolve(f.home, "launched.json");
  const server = await listen(
    f.store,
    commitThen({
      ok: true,
      stdout: '{"decision":"block","reason":"verify first"}\n',
      stderr: "",
      exitCode: 0,
      launches: [
        {
          entry: worker,
          args: [written],
          cwd: f.cwd,
          env: { LERVO_TERMINAL_HOOK_RUNTIME: "/runtime" },
        },
      ],
    }),
  );
  const stop = JSON.stringify({ hook_event_name: "Stop", session_id: "s" });
  expect(
    await launch(f, stop, { GIT_DIR: "/elsewhere/.git", LERVO_TEST_SESSION_MARKER: "session" }),
  ).toEqual({ code: 0, stdout: '{"decision":"block","reason":"verify first"}\n', stderr: "" });
  expect(server.requests[0]).toMatchObject({ kind: "stop", input: stop, umask: process.umask() });
  const session = server.requests[0]!.session as Record<string, string | null>;
  for (const name of TERMINAL_CONTEXT_SESSION_NAMES) expect(session).toHaveProperty(name);
  expect(session.PATH).toBe(f.environment.PATH ?? null);
  expect(session.GIT_DIR).toBe("/elsewhere/.git");
  // A detached child: wait for its file.
  let launched: unknown = null;
  for (let attempt = 0; attempt < 100 && launched === null; attempt++) {
    launched = await readFile(written, "utf8").then(JSON.parse, () => null);
    if (launched === null) await new Promise((done) => setTimeout(done, 20));
  }
  expect(launched).toEqual({ runtime: "/runtime", marker: "session" });
});

it("hands a pending answer's connection to a relay that starts the records' launches", async () => {
  const f = await fixture();
  const worker = resolve(f.home, "worker.mjs");
  await writeFile(
    worker,
    'import { writeFileSync } from "node:fs";\nwriteFileSync(process.argv[2], process.env.LERVO_TEST_SESSION_MARKER ?? "");\n',
  );
  const written = resolve(f.home, "relayed.txt");
  let later!: () => void;
  const server = await listen(f.store, (socket) => {
    socket.write("A");
    socket.once("data", () => {
      // The answer goes out first; the records' launches follow once the client has exited.
      socket.write(
        `${JSON.stringify({ ok: true, stdout: "{}\n", stderr: "", exitCode: 0, launches: [], pending: true })}\n`,
      );
      later = () =>
        socket.end(
          `${JSON.stringify({ launches: [{ entry: worker, args: [written], cwd: f.cwd, env: {} }] })}\n`,
        );
    });
  });
  const stop = JSON.stringify({ hook_event_name: "Stop", session_id: "s" });
  expect(await launch(f, stop, { LERVO_TEST_SESSION_MARKER: "session" })).toEqual({
    code: 0,
    stdout: "{}\n",
    stderr: "",
  });
  expect(server.requests[0]).toMatchObject({ kind: "stop", relay: true });
  later();
  let relayed: string | null = null;
  for (let attempt = 0; attempt < 150 && relayed === null; attempt++) {
    relayed = await readFile(written, "utf8").catch(() => null);
    if (relayed === null) await new Promise((done) => setTimeout(done, 20));
  }
  // Started from the session's environment, by the relay the client left behind.
  expect(relayed).toBe("session");
});

it.each([
  ["before the client exits", "whole"],
  ["split across the answer's chunk", "split"],
] as const)("relays the records' launches that arrive %s", async (_name, timing) => {
  const f = await fixture();
  const worker = resolve(f.home, "worker.mjs");
  await writeFile(
    worker,
    'import { writeFileSync } from "node:fs";\nwriteFileSync(process.argv[2], "ran");\n',
  );
  const written = resolve(f.home, `relayed-${timing}.txt`);
  const answerLine = `${JSON.stringify({ ok: true, stdout: "{}\n", stderr: "", exitCode: 0, launches: [], pending: true })}\n`;
  const launchesLine = `${JSON.stringify({ launches: [{ entry: worker, args: [written], cwd: f.cwd, env: {} }] })}\n`;
  await listen(f.store, (socket) => {
    socket.write("A");
    socket.once("data", () => {
      if (timing === "whole") {
        // The records finish at once: the second line reaches the client while it is still alive.
        socket.write(answerLine);
        setImmediate(() => socket.end(launchesLine));
      } else {
        // Part of the second line arrives in the answer's own chunk.
        socket.write(answerLine + launchesLine.slice(0, 12));
        setTimeout(() => socket.end(launchesLine.slice(12)), 200);
      }
    });
  });
  const stop = JSON.stringify({ hook_event_name: "Stop", session_id: "s" });
  expect((await launch(f, stop)).stdout).toBe("{}\n");
  let ran: string | null = null;
  for (let attempt = 0; attempt < 150 && ran === null; attempt++) {
    ran = await readFile(written, "utf8").catch(() => null);
    if (ran === null) await new Promise((done) => setTimeout(done, 20));
  }
  expect(ran).toBe("ran");
});

it("sends only prompts and Stops, and nothing when the socket is switched off", async () => {
  const f = await fixture();
  const server = await listen(
    f.store,
    commitThen({ ok: true, stdout: "served\n", stderr: "", exitCode: 0 }),
  );
  const start = JSON.stringify({ hook_event_name: "SessionStart", session_id: "s" });
  expect(await launch(f, start)).toEqual({ code: 0, stdout: start, stderr: "" });
  expect(await launch(f, prompt, { LERVO_TERMINAL_CONTEXT_SOCKET: "0" })).toEqual({
    code: 0,
    stdout: prompt,
    stderr: "",
  });
  expect(server.requests).toHaveLength(0);
});

it("never falls back once committed: a lost answer prints an empty context", async () => {
  const f = await fixture();
  await listen(f.store, commitThen(null));
  expect(await launch(f, prompt)).toEqual({ code: 0, stdout: "{}\n", stderr: "" });
});

it("sends exactly the environment the server compares", async () => {
  // The launcher cannot import the runtime, so it keeps its own copy of the closed list.
  const launcher = await readFile(source, "utf8");
  const listed = /const environmentNames = \[([^\]]*)\]/u.exec(launcher)![1]!;
  expect([...listed.matchAll(/"([A-Z_]+)"/gu)].map((match) => match[1])).toEqual([
    ...TERMINAL_CONTEXT_ENVIRONMENT,
  ]);
});

it("sends no prompt to a store that group or others can enter", async () => {
  const f = await fixture();
  const server = await listen(
    f.store,
    commitThen({ ok: true, stdout: "served\n", stderr: "", exitCode: 0 }),
  );
  await chmod(f.store, 0o710);
  expect(await launch(f, prompt)).toEqual({ code: 0, stdout: prompt, stderr: "" });
  expect(server.requests).toHaveLength(0);
});

// ADR-0645: a prompt the server could not take gets the base the server cached for this checkout.
const hookArgs = ["--provider", "claude", "--contract", "2"];
const cachedAnswer =
  '{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"cached"}}\n';
const sessionPrompt = JSON.stringify({
  hook_event_name: "UserPromptSubmit",
  session_id: "session-1",
  prompt: "fix the form",
});

async function cacheBase(f: Awaited<ReturnType<typeof fixture>>, mode = 0o600) {
  const environment = Object.fromEntries(
    TERMINAL_CONTEXT_ENVIRONMENT.map((name) => [name, f.environment[name] ?? null]),
  ) as Parameters<typeof terminalCachedBaseKey>[2];
  const directory = resolve(f.store, "base");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const key = terminalCachedBaseKey(f.cwd, hookArgs, environment);
  const file = resolve(directory, `${key}.json`);
  await writeFile(file, cachedAnswer, { mode });
  await chmod(file, mode);
  return { directory, key, file };
}

async function unserved(directory: string) {
  const names = (await readdir(directory)).filter((name) => name.endsWith(".unserved"));
  return Promise.all(
    names.map(async (name) => JSON.parse(await readFile(resolve(directory, name), "utf8"))),
  );
}

it.skipIf(process.platform === "win32")(
  "answers an unserved prompt from the cached base and leaves its markers",
  async () => {
    for (const [reason, setup] of [
      ["no_server", async () => undefined],
      [
        "declined_busy",
        (f: Awaited<ReturnType<typeof fixture>>) =>
          listen(f.store, (socket) => socket.end(`${JSON.stringify({ declined: "busy" })}\n`)),
      ],
      ["unreachable", (f: Awaited<ReturnType<typeof fixture>>) => listen(f.store, () => undefined)],
    ] as const) {
      const f = await fixture();
      const { directory } = await cacheBase(f);
      await setup(f);
      expect(await launch(f, sessionPrompt)).toEqual({ code: 0, stdout: cachedAnswer, stderr: "" });
      const [marker, ...rest] = await unserved(directory);
      expect(rest).toEqual([]);
      expect(marker.reason).toBe(reason);
      expect(marker.age).toBeGreaterThanOrEqual(0);
      expect(await answeredFromCachedBaseSince("session-1", Date.now() - 60_000, directory)).toBe(
        true,
      );
    }
  },
);

it.skipIf(process.platform === "win32")(
  "runs in process when the cached base cannot stand for the hook",
  async () => {
    // Each case caches a fresh base first, then changes one thing.
    type Setup = (f: Awaited<ReturnType<typeof fixture>>) => Promise<unknown>;
    const setups: Setup[] = [
      // A decline the hook itself must answer.
      (f) =>
        listen(f.store, (socket) =>
          socket.end(`${JSON.stringify({ declined: "runtime_mismatch" })}\n`),
        ),
      // An old base.
      async (f) => {
        const { file } = await cacheBase(f);
        const old = new Date(Date.now() - 31 * 60_000);
        await utimes(file, old, old);
      },
      // A base others can read.
      (f) => cacheBase(f, 0o644),
    ];
    const cases: [Setup, string?][] = setups.map((setup) => [setup]);
    cases.push([
      async () => undefined,
      JSON.stringify({ hook_event_name: "Stop", session_id: "s" }),
    ]);
    for (const [setup, input = sessionPrompt] of cases) {
      const f = await fixture();
      const { directory } = await cacheBase(f);
      await setup(f);
      expect((await launch(f, input)).stdout).toBe(input);
      expect(await unserved(directory)).toEqual([]);
    }
    // A session whose compared variables differ never matches the base the server wrote.
    const f = await fixture();
    await cacheBase(f);
    expect((await launch(f, sessionPrompt, { XDG_STATE_HOME: resolve(f.home, "s") })).stdout).toBe(
      sessionPrompt,
    );
  },
);
