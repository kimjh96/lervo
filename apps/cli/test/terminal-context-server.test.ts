import { connect } from "node:net";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import {
  effectiveTerminalContextEnvironment,
  terminalContextEnvironment,
  type TerminalContextAnswer,
  type TerminalContextRequest,
} from "../src/terminal-context-request.js";
import {
  startTerminalContextServer,
  type TerminalContextServer,
} from "../src/terminal-context-server.js";

const runtimeHash = `sha256:${"a".repeat(64)}`;
const environment = { HOME: "/home/owner", CODEX_HOME: undefined } as NodeJS.ProcessEnv;
const cleanups: (() => Promise<void>)[] = [];
let current: TerminalContextServer;

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

async function serverWith(
  run: (request: TerminalContextRequest) => Promise<TerminalContextAnswer>,
  onOverrun?: () => void,
  runLimitMs?: number,
) {
  // Short: a Unix socket path holds about a hundred bytes.
  const directory = await mkdtemp(resolve(tmpdir(), "lvctx-"));
  const socketPath = resolve(directory, "context.s");
  const server = startTerminalContextServer({
    socketPath,
    runtimeHash,
    environment,
    run,
    ...(onOverrun === undefined ? {} : { onOverrun }),
    ...(runLimitMs === undefined ? {} : { runLimitMs }),
  });
  await server.ready;
  current = server;
  cleanups.push(async () => {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  return socketPath;
}

function request(patch: Partial<TerminalContextRequest> = {}): TerminalContextRequest {
  return {
    version: 1,
    kind: "prompt",
    runtime: runtimeHash,
    cwd: "/work/repository",
    args: ["--provider", "claude", "--contract", "2"],
    environment: terminalContextEnvironment(environment),
    elapsed: 40,
    input: '{"hook_event_name":"UserPromptSubmit","prompt":"private"}',
    ...patch,
  };
}

/** Sends `line`, commits with `G` when `commit`, and collects everything the server writes. */
function exchange(socketPath: string, line: string, commit = true, together = false) {
  return new Promise<string>((done) => {
    const socket = connect(socketPath);
    let received = "";
    // A declined oversized request closes while the client still writes; its answer still arrives.
    socket.on("error", () => undefined);
    socket.on("connect", () => socket.write(together && commit ? `${line}\nG` : `${line}\n`));
    socket.on("data", (chunk) => {
      received += chunk.toString();
      if (received === "A") {
        if (!commit) socket.end();
        else if (!together) socket.write("G");
      }
    });
    socket.on("close", () => done(received));
  });
}

const answer: TerminalContextAnswer = {
  stdout: '{"hookSpecificOutput":{}}\n',
  stderr: "",
  exitCode: 0,
  overran: false,
};

it("answers a committed prompt with what the hook printed, over an owner-only socket", async () => {
  const run = vi.fn(async () => answer);
  const socketPath = await serverWith(run);
  expect((await stat(socketPath)).mode & 0o777).toBe(0o600);
  const received = await exchange(socketPath, JSON.stringify(request()));
  expect(received.slice(0, 1)).toBe("A");
  expect(JSON.parse(received.slice(1))).toEqual({
    ok: true,
    stdout: answer.stdout,
    stderr: "",
    exitCode: 0,
    launches: [],
  });
  expect(run).toHaveBeenCalledWith(request());
  // A client may send the request and its commit in one write.
  expect((await exchange(socketPath, JSON.stringify(request()), true, true)).slice(0, 1)).toBe("A");
  expect(run).toHaveBeenCalledTimes(2);
});

it("answers a failed claim as no answer, so the launcher decides it in process", async () => {
  const run = vi.fn(async () => Promise.reject(new Error("broken")));
  const socketPath = await serverWith(run);
  const claim = request({
    kind: "tool",
    input: JSON.stringify({ hook_event_name: "PreToolUse", session_id: "s" }),
  });
  const received = await exchange(socketPath, JSON.stringify(claim));
  expect(JSON.parse(received.slice(1))).toEqual({ ok: false });
  // Any other failed hook still answers with an empty context.
  const prompted = await exchange(socketPath, JSON.stringify(request()));
  expect(JSON.parse(prompted.slice(1))).toMatchObject({ ok: true, stdout: "{}\n" });
});

it("declines before anything runs, with a closed reason", async () => {
  const run = vi.fn(async () => answer);
  const socketPath = await serverWith(run);
  const declined = async (line: string) =>
    JSON.parse(await exchange(socketPath, line, false)) as { declined: string };
  expect(await declined(JSON.stringify(request({ runtime: `sha256:${"b".repeat(64)}` })))).toEqual({
    declined: "runtime_mismatch",
  });
  expect(
    await declined(
      JSON.stringify(
        request({ environment: { ...request().environment, CODEX_HOME: "/elsewhere" } }),
      ),
    ),
  ).toEqual({ declined: "environment_mismatch" });
  expect(await declined("{not json")).toEqual({ declined: "invalid_request" });
  expect(await declined(JSON.stringify({ ...request(), cwd: "relative" }))).toEqual({
    declined: "invalid_request",
  });
  expect(await declined(JSON.stringify(request({ input: "x".repeat(300 * 1024) })))).toEqual({
    declined: "request_too_large",
  });
  expect(run).not.toHaveBeenCalled();
});

it("runs nothing for a client that leaves before committing, and then serves the next one", async () => {
  const run = vi.fn(async () => answer);
  const socketPath = await serverWith(run);
  expect(await exchange(socketPath, JSON.stringify(request()), false)).toBe("A");
  expect(run).not.toHaveBeenCalled();
  const received = await exchange(socketPath, JSON.stringify(request()));
  expect(JSON.parse(received.slice(1))).toMatchObject({ ok: true });
  expect(run).toHaveBeenCalledTimes(1);
});

it("declines a second prompt while one runs, and exits after a prompt that overran", async () => {
  let finish: (value: TerminalContextAnswer) => void = () => undefined;
  const run = vi.fn(
    () =>
      new Promise<TerminalContextAnswer>((done) => {
        finish = done;
      }),
  );
  const onOverrun = vi.fn();
  const socketPath = await serverWith(run, onOverrun);
  const first = exchange(socketPath, JSON.stringify(request()));
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  expect(JSON.parse(await exchange(socketPath, JSON.stringify(request()), false))).toEqual({
    declined: "busy",
  });
  finish({ ...answer, overran: true });
  expect(JSON.parse((await first).slice(1))).toMatchObject({ ok: true });
  await vi.waitFor(() => expect(onOverrun).toHaveBeenCalledTimes(1));
});

it("exits when the work after a drained answer left reads running, and not otherwise", async () => {
  for (const settled of [false, true]) {
    const onOverrun = vi.fn();
    const afterDrain = vi.fn(async () => settled);
    const socketPath = await serverWith(async () => ({ ...answer, afterDrain }), onOverrun);
    expect(
      JSON.parse((await exchange(socketPath, JSON.stringify(request()))).slice(1)),
    ).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(afterDrain).toHaveBeenCalledTimes(1));
    await new Promise((done) => setTimeout(done, 20));
    expect(onOverrun).toHaveBeenCalledTimes(settled ? 0 : 1);
  }
});

it("gives up on a prompt that never settles", async () => {
  const onOverrun = vi.fn();
  const socketPath = await serverWith(() => new Promise(() => undefined), onOverrun, 50);
  void exchange(socketPath, JSON.stringify(request()));
  await vi.waitFor(() => expect(onOverrun).toHaveBeenCalledTimes(1));
});

it("removes only the socket it bound, never a newer server's", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "lvctx-"));
  const socketPath = resolve(directory, "context.s");
  const run = async () => answer;
  const older = startTerminalContextServer({ socketPath, runtimeHash, environment, run });
  await older.ready;
  const newer = startTerminalContextServer({ socketPath, runtimeHash, environment, run });
  await newer.ready;
  older.releaseSocket();
  expect((await stat(socketPath)).isSocket()).toBe(true);
  expect(
    JSON.parse((await exchange(socketPath, JSON.stringify(request()))).slice(1)),
  ).toMatchObject({ ok: true });
  await older.close();
  await newer.close();
  await expect(stat(socketPath)).rejects.toThrow();
  await rm(directory, { recursive: true, force: true });
});

it("waits for work a prompt left running before the next one, and exits if it never settles", async () => {
  let settle: (value: boolean) => void = () => undefined;
  const onOverrun = vi.fn();
  const socketPath = await serverWith(
    async () => ({
      ...answer,
      drain: () =>
        new Promise<boolean>((done) => {
          settle = done;
        }),
    }),
    onOverrun,
  );
  expect(
    JSON.parse((await exchange(socketPath, JSON.stringify(request()))).slice(1)),
  ).toMatchObject({ ok: true });
  // The answer went out; the work it left running still holds the server.
  expect(JSON.parse(await exchange(socketPath, JSON.stringify(request()), false))).toEqual({
    declined: "busy",
  });
  settle(true);
  await vi.waitFor(async () =>
    expect((await exchange(socketPath, JSON.stringify(request()), false)).slice(0, 1)).toBe("A"),
  );
  expect(onOverrun).not.toHaveBeenCalled();
  // The next prompt's work never settles in time: the server exits instead of serving on.
  await exchange(socketPath, JSON.stringify(request()));
  settle(false);
  await vi.waitFor(() => expect(onOverrun).toHaveBeenCalledTimes(1));
});

it("compares what each variable means, so a service's explicit defaults still match", () => {
  const unset = terminalContextEnvironment({ HOME: "/Users/owner" });
  const explicit = terminalContextEnvironment({
    HOME: "/Users/owner",
    LERVO_USER_STATE_DIRECTORY: "/Users/owner/Library/Application Support/Lervo",
    CODEX_HOME: "/Users/owner/.codex",
  });
  expect(effectiveTerminalContextEnvironment(unset, "darwin")).toEqual(
    effectiveTerminalContextEnvironment(explicit, "darwin"),
  );
  const elsewhere = terminalContextEnvironment({
    HOME: "/Users/owner",
    LERVO_USER_STATE_DIRECTORY: "/Volumes/other/Lervo",
  });
  expect(effectiveTerminalContextEnvironment(elsewhere, "darwin")).not.toEqual(
    effectiveTerminalContextEnvironment(unset, "darwin"),
  );
  // On Linux the default follows XDG_STATE_HOME.
  expect(
    effectiveTerminalContextEnvironment(
      terminalContextEnvironment({
        HOME: "/home/owner",
        XDG_STATE_HOME: "/home/owner/.local/state",
      }),
      "linux",
    ).LERVO_USER_STATE_DIRECTORY,
  ).toBe("/home/owner/.local/state/lervo");
});

it("reports each outcome", async () => {
  const outcomes: string[] = [];
  const directory = await mkdtemp(resolve(tmpdir(), "lvctx-"));
  const socketPath = resolve(directory, "context.s");
  const server = startTerminalContextServer({
    socketPath,
    runtimeHash,
    environment,
    run: async () => answer,
    onOutcome: (outcome) => outcomes.push(outcome),
  });
  await server.ready;
  await exchange(socketPath, JSON.stringify(request()));
  await exchange(
    socketPath,
    JSON.stringify(request({ runtime: `sha256:${"c".repeat(64)}` })),
    false,
  );
  expect(outcomes).toEqual(["served", "runtime_mismatch"]);
  await server.close();
  await rm(directory, { recursive: true, force: true });
});

const stopInput = '{"hook_event_name":"Stop","session_id":"s"}';

it("serves a Stop as it serves a prompt, and runs only the hook a request's kind names", async () => {
  const run = vi.fn(async () => ({
    ...answer,
    launches: [{ entry: "/cli/bin.js", args: ["settle-turns"], cwd: "/work", env: {} }],
  }));
  const socketPath = await serverWith(run);
  const stop = request({ kind: "stop", input: stopInput });
  const received = await exchange(socketPath, JSON.stringify(stop));
  // The client, not the server, starts what the hook asked for.
  expect(JSON.parse(received.slice(1))).toMatchObject({
    ok: true,
    launches: [{ entry: "/cli/bin.js", args: ["settle-turns"], cwd: "/work", env: {} }],
  });
  expect(run).toHaveBeenCalledWith(stop);
  const claimInput = '{"hook_event_name":"PreToolUse","session_id":"s","tool_name":"Edit"}';
  const claim = request({ kind: "tool", input: claimInput });
  expect(JSON.parse((await exchange(socketPath, JSON.stringify(claim))).slice(1))).toMatchObject({
    ok: true,
  });
  expect(run).toHaveBeenCalledWith(claim);
  for (const mismatched of [
    request({ kind: "stop" }),
    request({ kind: "tool" }),
    request({ kind: "tool", input: stopInput }),
    request({ input: claimInput }),
    request({ input: stopInput }),
    { ...request(), kind: "session" },
    request({ input: "not json" }),
  ])
    expect(await exchange(socketPath, JSON.stringify(mismatched))).toBe(
      `${JSON.stringify({ declined: "invalid_request" })}\n`,
    );
  expect(run).toHaveBeenCalledTimes(2);
});

it("accepts only a well-formed session environment and umask", async () => {
  const run = vi.fn(async () => answer);
  const socketPath = await serverWith(run);
  const session = { PATH: "/usr/bin", XDG_RUNTIME_DIR: null, DBUS_SESSION_BUS_ADDRESS: null };
  expect(
    (await exchange(socketPath, JSON.stringify(request({ session, umask: 0o022 })))).slice(0, 1),
  ).toBe("A");
  for (const malformed of [
    { session: { PATH: "/usr/bin" } },
    { session: { ...session, SECRET_TOKEN: "x" } },
    { session: { ...session, GIT_DIR: 7 } },
    { umask: 0o1000 },
    { umask: 1.5 },
  ])
    expect(await exchange(socketPath, JSON.stringify({ ...request(), ...malformed }))).toBe(
      `${JSON.stringify({ declined: "invalid_request" })}\n`,
    );
  expect(run).toHaveBeenCalledTimes(1);
});

it("finishes the hook in flight before it stops, and accepts nothing meanwhile", async () => {
  let release!: () => void;
  const run = vi.fn(
    () => new Promise<TerminalContextAnswer>((done) => (release = () => done(answer))),
  );
  const socketPath = await serverWith(run);
  const inFlight = exchange(
    socketPath,
    JSON.stringify(request({ kind: "stop", input: stopInput })),
  );
  await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  let finished = false;
  const finishing = current.finish().then(() => (finished = true));
  // The socket is gone at once, so the next hook runs in its own process.
  await expect(stat(socketPath)).rejects.toMatchObject({ code: "ENOENT" });
  await new Promise((done) => setTimeout(done, 50));
  expect(finished).toBe(false);
  release();
  expect(JSON.parse((await inFlight).slice(1))).toMatchObject({ ok: true, stdout: answer.stdout });
  await finishing;
  expect(finished).toBe(true);
});

it("finishes at once when nothing is in flight", async () => {
  await serverWith(vi.fn(async () => answer));
  await current.finish();
});

it("still runs a hook whose client read A but had not sent G when the server began to stop", async () => {
  const run = vi.fn(async () => answer);
  const socketPath = await serverWith(run);
  const received = await new Promise<string>((done) => {
    const socket = connect(socketPath);
    let text = "";
    socket.on("connect", () =>
      socket.write(`${JSON.stringify(request({ kind: "stop", input: stopInput }))}\n`),
    );
    socket.on("data", (chunk) => {
      text += chunk.toString();
      if (text === "A") {
        // The client already counts as committed and will never fall back.
        void current.finish();
        setTimeout(() => socket.write("G"), 20);
      }
    });
    socket.on("close", () => done(text));
  });
  expect(JSON.parse(received.slice(1))).toMatchObject({ ok: true, stdout: answer.stdout });
  expect(run).toHaveBeenCalledTimes(1);
});

it("sends a relaying client the records' launches on a second line once they finish", async () => {
  let release!: () => void;
  const records = new Promise<void>((done) => (release = done));
  const run = vi.fn(async () => ({
    ...answer,
    pending: true,
    drain: async () => {
      await records;
      return true;
    },
    laterLaunches: () => [{ entry: "/cli/bin.js", args: ["settle-turns"], cwd: "/work", env: {} }],
  }));
  const socketPath = await serverWith(run);
  const lines: string[] = [];
  const done = new Promise<void>((finish) => {
    const socket = connect(socketPath);
    let text = "";
    socket.on("connect", () =>
      socket.write(`${JSON.stringify(request({ kind: "stop", input: stopInput, relay: true }))}\n`),
    );
    socket.on("data", (chunk) => {
      text += chunk.toString();
      if (text === "A") {
        text = "";
        socket.write("G");
      }
      while (text.includes("\n")) {
        lines.push(text.slice(0, text.indexOf("\n")));
        text = text.slice(text.indexOf("\n") + 1);
        if (lines.length === 1) release();
      }
    });
    socket.on("close", () => finish());
  });
  await done;
  expect(JSON.parse(lines[0]!)).toMatchObject({ ok: true, pending: true });
  expect(JSON.parse(lines[1]!)).toEqual({
    launches: [{ entry: "/cli/bin.js", args: ["settle-turns"], cwd: "/work", env: {} }],
  });
});

it("ends at the answer for a client that does not relay", async () => {
  const run = vi.fn(async () => ({ ...answer, pending: true, laterLaunches: () => [] }));
  const socketPath = await serverWith(run);
  const received = await exchange(socketPath, JSON.stringify(request()));
  expect(received.slice(1).trim().split("\n")).toHaveLength(1);
  expect(JSON.parse(received.slice(1))).not.toHaveProperty("pending");
});

it("reports how long each served hook took to answer, from the client's start", async () => {
  const answered: [string, number][] = [];
  const directory = await mkdtemp(resolve(tmpdir(), "lvctx-"));
  const socketPath = resolve(directory, "context.s");
  const server = startTerminalContextServer({
    socketPath,
    runtimeHash,
    environment,
    run: async () => {
      await new Promise((done) => setTimeout(done, 30));
      return answer;
    },
    onAnswered: (kind, milliseconds) => answered.push([kind, milliseconds]),
  });
  await server.ready;
  await exchange(socketPath, JSON.stringify(request({ elapsed: 40 })));
  expect(answered).toHaveLength(1);
  expect(answered[0]![0]).toBe("prompt");
  // The client's 40 ms before sending, plus the hook's own 30 ms or more.
  expect(answered[0]![1]).toBeGreaterThanOrEqual(69);
  await server.close();
  await rm(directory, { recursive: true, force: true });
});
