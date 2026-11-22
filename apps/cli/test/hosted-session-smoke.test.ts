import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { coreLinkHandlers } from "../src/application-serve-command.js";
import { CoreLinkServer } from "../src/core-link-server.js";
import { runCli } from "../src/main.js";

/**
 * Opt-in smoke test of a real hosted Claude Code session (ADE roadmap, S1.4b). It spends a little
 * of the signed-in user's Claude usage, so it runs only with LERVO_HOSTED_SMOKE=1 and a `claude`
 * CLI on PATH: `LERVO_HOSTED_SMOKE=1 pnpm exec vitest run apps/cli/test/hosted-session-smoke.test.ts`.
 */
const enabled = process.env.LERVO_HOSTED_SMOKE === "1";
const execute = promisify(execFile);
const roots: string[] = [];

function io(cwd: string) {
  const stdout: string[] = [];
  return {
    stdout,
    io: { cwd, stdout: (message: string) => stdout.push(message), stderr: () => undefined },
  };
}

async function registeredRepository() {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-hosted-smoke-")));
  roots.push(root);
  const repository = resolve(root, "app");
  await mkdir(repository);
  vi.stubEnv("LERVO_USER_STATE_DIRECTORY", resolve(root, "state"));
  const git = (...arguments_: string[]) => execute("git", ["-C", repository, ...arguments_]);
  await git("init", "--initial-branch", "main");
  await git("config", "user.email", "lervo-test@example.invalid");
  await git("config", "user.name", "Lervo Test");
  await writeFile(resolve(repository, "README.md"), "app\n");
  expect(await runCli(["init", "--root", repository, "--name", "app"], io(root).io)).toBe(0);
  await git("add", "-A");
  await git("commit", "-m", "base");
  const registered = io(root);
  const registry = resolve(root, "state", "repositories.json");
  const command = ["repository", "register", "--root", repository, "--registry", registry];
  expect(await runCli([...command, "--write", "--json"], registered.io)).toBe(0);
  return (JSON.parse(registered.stdout.join("")) as { registration: { projectId: string } })
    .registration.projectId;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe.skipIf(!enabled)("a hosted Claude Code session", () => {
  it("starts from an instruction and streams its messages and tool activity", async () => {
    const projectId = await registeredRepository();
    const responses: Record<string, unknown>[] = [];
    const waiters = new Map<number, (response: Record<string, unknown>) => void>();
    const requests: string[] = [];
    let push: (() => void) | undefined;
    const server = new CoreLinkServer(coreLinkHandlers, (line) => {
      const response = JSON.parse(line) as Record<string, unknown>;
      responses.push(response);
      waiters.get(response.id as number)?.(response);
    });
    async function* input() {
      while (true) {
        while (requests.length > 0) yield `${requests.shift()}\n`;
        await new Promise<void>((resolve) => (push = resolve));
      }
    }
    void server.serve(input());
    let nextId = 1;
    const ask = (request: Record<string, unknown>) =>
      new Promise<Record<string, unknown>>((resolve) => {
        const id = nextId++;
        waiters.set(id, resolve);
        requests.push(JSON.stringify({ ...request, id }));
        push?.();
      });

    const started = await ask({
      kind: "core.command",
      command: "workspace.start",
      arguments: {
        instruction:
          "Create a file named hello.txt that contains the word hello, then reply with the single word done.",
        repository: projectId,
        model: "haiku",
      },
    });
    expect(started.kind, JSON.stringify(started)).toBe("core.result");
    const launch = started.launch as {
      program: string;
      arguments: string[];
      workingDirectory: string;
      initialInput: string;
    };
    await ask({ kind: "decoder.open", decoderId: "dec_1", provider: "claude" });
    const child = spawn(launch.program, launch.arguments, {
      cwd: launch.workingDirectory,
      stdio: ["pipe", "pipe", "ignore"],
    });
    const sent = await ask({ kind: "decoder.send", decoderId: "dec_1", text: launch.initialInput });
    child.stdin.write(Buffer.from(String(sent.input), "base64"));

    const events: { kind: string; event?: string; content?: { kind: string; name?: string } }[] = [
      ...(sent.events as never[]),
    ];
    for await (const chunk of child.stdout) {
      const decoded = await ask({
        kind: "decoder.output",
        decoderId: "dec_1",
        data: Buffer.from(chunk as Buffer).toString("base64"),
      });
      events.push(...(decoded.events as never[]));
      if (events.some((event) => event.event === "turn_finished")) break;
    }
    child.stdin.end();
    child.kill();

    expect(events.at(-1)).toEqual({ kind: "status", event: "turn_finished" });
    expect(events.some((event) => event.kind === "delta")).toBe(true);
    expect(
      events.some(
        (event) => event.content?.kind === "tool_activity" && event.content.name === "Write",
      ),
    ).toBe(true);
    expect(await readFile(resolve(launch.workingDirectory, "hello.txt"), "utf8")).toContain(
      "hello",
    );
  }, 180_000);
});
