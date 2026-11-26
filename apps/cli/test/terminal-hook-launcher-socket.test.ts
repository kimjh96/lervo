import { spawn } from "node:child_process";
import { createServer, type Server, type Socket } from "node:net";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { TERMINAL_CONTEXT_ENVIRONMENT } from "../src/terminal-context-server.js";
import { TERMINAL_CONTEXT_SESSION_NAMES } from "../src/terminal-context-session.js";
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

async function fixture() {
  // Short: the store holds a Unix socket, whose path is limited to about a hundred bytes.
  const home = await realpath(await mkdtemp(resolve(tmpdir(), "lvl-")));
  const cwd = resolve(home, "repository");
  await mkdir(cwd, { recursive: true });
  const environment: NodeJS.ProcessEnv = { ...process.env, HOME: home, USERPROFILE: home };
  delete environment.LERVO_TERMINAL_CONTEXT_SOCKET;
  const store = terminalHookRuntimeStorePath(environment, process.platform, home);
  await materializeHostTerminalRuntime({ store, runtimeContent, assets: [] });
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
