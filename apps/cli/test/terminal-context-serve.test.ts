import { afterEach, expect, it, vi } from "vitest";

// The served hook stands in for the real one: it reports the variables and mask it ran with, and
// asks for a detached worker, as a Stop does.
const seen: { path?: string; gitDir?: string; umask?: number }[] = [];
vi.mock("../src/terminal-hook-command.js", () => ({
  runTerminalHookCommand: vi.fn(async (_args: string[], io: { stdout: (m: string) => void }) => {
    const { launchDetachedKnowledgeWorker } = await import("../src/detached-knowledge-worker.js");
    seen.push({
      ...(process.env.PATH === undefined ? {} : { path: process.env.PATH }),
      ...(process.env.GIT_DIR === undefined ? {} : { gitDir: process.env.GIT_DIR }),
      umask: process.umask(),
    });
    expect(
      await launchDetachedKnowledgeWorker({ root: "/work", entry: "/cli/bin.js", args: ["w"] }),
    ).toBe(true);
    io.stdout("{}\n");
    return 0;
  }),
}));

const { runServedTerminalHook } = await import("../src/terminal-context-serve.js");
const { launchDetachedKnowledgeWorker } = await import("../src/detached-knowledge-worker.js");

const ownPath = process.env.PATH;
const ownMask = process.umask();
afterEach(() => {
  seen.length = 0;
  delete process.env.LERVO_TERMINAL_HOOK_RUNTIME;
});

const request = {
  version: 1 as const,
  kind: "stop" as const,
  runtime: `sha256:${"a".repeat(64)}`,
  cwd: "/work",
  args: ["--provider", "claude", "--contract", "2"],
  environment: {} as never,
  elapsed: 3,
  input: '{"hook_event_name":"Stop"}',
};

it("runs the hook with the session's values and mask, and hands its launches to the client", async () => {
  process.env.LERVO_TERMINAL_HOOK_RUNTIME = "/store/runtime-v2.mjs";
  const answer = await runServedTerminalHook({
    ...request,
    session: {
      PATH: "/session/bin",
      XDG_RUNTIME_DIR: null,
      DBUS_SESSION_BUS_ADDRESS: null,
      GIT_DIR: "/g",
    },
    umask: 0o022,
  });
  expect(seen).toEqual([{ path: "/session/bin", gitDir: "/g", umask: 0o022 }]);
  expect(answer).toMatchObject({
    stdout: "{}\n",
    exitCode: 0,
    launches: [
      {
        entry: "/cli/bin.js",
        args: ["w"],
        cwd: "/work",
        env: { LERVO_TERMINAL_HOOK_RUNTIME: "/store/runtime-v2.mjs" },
      },
    ],
  });
  // Until the leftover work drained, nothing else runs; then the server's own values return.
  expect(process.env.PATH).toBe("/session/bin");
  expect(await answer.drain?.()).toBe(true);
  expect(process.env.PATH).toBe(ownPath);
  expect(process.env.GIT_DIR).toBeUndefined();
  expect(process.umask()).toBe(ownMask);
});

it("keeps the server's values for a client that sends none, and launches directly again afterwards", async () => {
  const answer = await runServedTerminalHook(request);
  expect(seen).toEqual([{ path: ownPath, umask: ownMask }]);
  await answer.drain?.();
  // Outside a served hook, a launch starts a process here again; a missing entry fails to spawn.
  expect(
    await launchDetachedKnowledgeWorker({
      root: "/nonexistent-directory-for-lervo-test",
      entry: "/nonexistent.mjs",
      args: [],
    }),
  ).toBe(false);
});
