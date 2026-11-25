import { connect } from "node:net";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

import {
  startTerminalContextServer,
  terminalContextEnvironment,
  type TerminalContextAnswer,
  type TerminalContextRequest,
} from "../src/terminal-context-server.js";

const runtimeHash = `sha256:${"a".repeat(64)}`;
const environment = { HOME: "/home/owner", CODEX_HOME: undefined } as NodeJS.ProcessEnv;
const cleanups: (() => Promise<void>)[] = [];

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
  });
  expect(run).toHaveBeenCalledWith(request());
  // A client may send the request and its commit in one write.
  expect((await exchange(socketPath, JSON.stringify(request()), true, true)).slice(0, 1)).toBe("A");
  expect(run).toHaveBeenCalledTimes(2);
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
